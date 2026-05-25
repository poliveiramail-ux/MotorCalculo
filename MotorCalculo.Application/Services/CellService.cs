using MotorCalculo.Application.DTOs;
using MotorCalculo.Application.Exceptions;
using MotorCalculo.Engine.Models;
using MotorCalculo.Engine.Session;
using MotorCalculo.Infrastructure.Repositories.Interfaces;

namespace MotorCalculo.Application.Services;

/// <summary>
/// Serviço crítico — orquestra a edição de uma célula:
///   1. Carrega dados necessários (template, projecto, células)
///   2. Invoca o motor de cálculo
///   3. Persiste o resultado
///   4. Devolve o delta ao controller
/// </summary>
public sealed class CellService(
    IVersionRepository  versionRepo,
    IProjectRepository  projectRepo,
    ITemplateRepository templateRepo,
    ICellRepository     cellRepo)
{
    // ── Edição de uma célula ──────────────────────────────────

    public async Task<EditCellResponse> EditCellAsync(
        EditCellRequest request,
        CancellationToken ct = default)
    {
        // 1 — Carrega versão → projecto → template
        var version = await versionRepo.GetByIdAsync(request.VersionId, ct)
            ?? throw new NotFoundException("Version", request.VersionId);

        var project = await projectRepo.GetByIdAsync(version.ProjectId, ct)
            ?? throw new NotFoundException("Project", version.ProjectId);

        var variables = await templateRepo.GetVariableDefinitionsAsync(project.TemplateId, ct);
        var structure = await projectRepo.GetStructureAsync(version.ProjectId, ct)
            ?? throw new NotFoundException("ProjectStructure", version.ProjectId);

        // 2 — Carrega todas as células da versão (working set)
        var cells = await cellRepo.LoadVersionCellsAsync(request.VersionId, ct);

        // 3 — Constrói a célula editada e coloca-a no working set
        var editedKey = new CellKey(
            request.VersionId,
            request.Year,
            request.Month,
            request.VariableId,
            request.LanguageId,
            request.LobId);

        var editedValue = BuildEditedCell(request);
        cells[editedKey] = editedValue;

        // 4 — Determina períodos presentes na versão
        var periods = ExtractPeriods(cells, request.Year, request.Month);

        // 5 — Executa o motor de cálculo
        var session = new CalculationSession(variables, periods, structure);
        var delta   = session.Run(editedKey, cells);

        // 6 — Persiste: célula editada + delta calculado
        var sessionId = Guid.NewGuid();
        await cellRepo.SaveEditAsync(editedKey, editedValue, delta, sessionId, ct);

        // 7 — Devolve o delta ao controller
        var deltaDto = delta.Select(c => MapToDto(c.Key, c.After)).ToList();

        return new EditCellResponse(deltaDto, deltaDto.Count, sessionId);
    }

    // ── Carregamento de uma versão completa ───────────────────

    public async Task<LoadVersionResponse> LoadVersionCellsAsync(
        int versionId, CancellationToken ct = default)
    {
        _ = await versionRepo.GetByIdAsync(versionId, ct)
            ?? throw new NotFoundException("Version", versionId);

        var cells = await cellRepo.LoadVersionCellsAsync(versionId, ct);

        var dtos = cells.Select(kv => MapToDto(kv.Key, kv.Value)).ToList();

        return new LoadVersionResponse(versionId, dtos);
    }

    // ── Helpers ───────────────────────────────────────────────

    /// <summary>
    /// Constrói o CellValue para a célula editada.
    /// Value=null ou source limpar → status=Empty.
    /// </summary>
    private static CellValue BuildEditedCell(EditCellRequest request)
    {
        var source = request.Source == "imported"
            ? CellSource.Imported
            : CellSource.Manual;

        if (request.Value is null)
            return new CellValue { Status = CellStatus.Empty, Source = source };

        return new CellValue
        {
            Value  = request.Value,
            Status = CellStatus.Ok,
            Source = source,
        };
    }

    /// <summary>
    /// Extrai os períodos YYYYMM presentes nas células.
    /// Garante que o período editado está sempre incluído.
    /// Se não houver células, usa os 18 meses a partir do período editado.
    /// </summary>
    private static IReadOnlyList<int> ExtractPeriods(
        Dictionary<CellKey, CellValue> cells,
        int editedYear, int editedMonth)
    {
        var editedPeriod = editedYear * 100 + editedMonth;

        if (cells.Count == 0)
        {
            // Versão nova sem dados — usa 18 meses a partir do período editado
            return Enumerable.Range(0, 18)
                .Select(i =>
                {
                    var dt = new DateTime(editedYear, editedMonth, 1).AddMonths(i);
                    return dt.Year * 100 + dt.Month;
                })
                .ToList();
        }

        var periods = cells.Keys
            .Select(k => k.Year * 100 + k.Month)
            .Distinct()
            .ToHashSet();

        periods.Add(editedPeriod); // garante que o período editado está incluído

        return [.. periods.OrderBy(p => p)];
    }

    private static CellDto MapToDto(CellKey key, CellValue value) => new(
        VariableId: key.VariableId,
        LanguageId: key.LanguageId,
        LobId:      key.LobId,
        Year:       key.Year,
        Month:      key.Month,
        Value:      value.Value,
        Status:     value.Status switch
        {
            CellStatus.Ok       => "ok",
            CellStatus.Error    => "error",
            CellStatus.Circular => "circular",
            _                   => "empty"
        },
        Source:     value.Source switch
        {
            CellSource.Formula   => "formula",
            CellSource.Imported  => "imported",
            _                    => "manual"
        },
        FormulaId:  value.FormulaId
    );
}
