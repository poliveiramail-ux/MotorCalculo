using MotorCalculo.Engine.Models;
using MotorCalculo.Engine.Session;
using MotorCalculo.Infrastructure.Entities;

namespace MotorCalculo.Infrastructure.Repositories.Interfaces;

// ─────────────────────────────────────────────────────────────
//  Interfaces dos repositórios.
//  A camada Application depende apenas destas interfaces —
//  nunca das implementações concretas.
// ─────────────────────────────────────────────────────────────

/// <summary>
/// Acesso a templates, variáveis e fórmulas.
/// Dados carregados uma vez por sessão e normalmente cacheados.
/// </summary>
public interface ITemplateRepository
{
    /// <summary>Metadados do template.</summary>
    Task<TemplateEntity?> GetByIdAsync(int templateId, CancellationToken ct = default);

    /// <summary>Todos os templates disponíveis.</summary>
    Task<IReadOnlyList<TemplateEntity>> GetAllAsync(CancellationToken ct = default);

    /// <summary>
    /// Carrega todas as variáveis e fórmulas do template,
    /// devolvendo os tipos que o Engine consome directamente.
    /// </summary>
    Task<IReadOnlyList<VariableDefinition>> GetVariableDefinitionsAsync(
        int templateId, CancellationToken ct = default);
    Task<TemplateEntity>  CreateAsync(string code, string name, string? description, CancellationToken ct = default);
    Task<TemplateEntity>  UpdateAsync(int templateId, string code, string name, string? description, CancellationToken ct = default);
    Task                  DeleteAsync(int templateId, CancellationToken ct = default);
}

/// <summary>
/// Acesso à estrutura do projecto (línguas + LOBs).
/// </summary>
public interface IProjectRepository
{
    Task<ProjectEntity?> GetByIdAsync(int projectId, CancellationToken ct = default);
    Task<IReadOnlyList<ProjectEntity>> GetAllAsync(CancellationToken ct = default);

    /// <summary>
    /// Carrega línguas e LOBs do projecto,
    /// devolvendo o tipo que o Engine consome directamente.
    /// </summary>
    Task<ProjectStructure?> GetStructureAsync(int projectId, CancellationToken ct = default);

    Task<ProjectEntity> CreateAsync(int templateId, string code, string name, CancellationToken ct = default);
    Task<ProjectEntity> UpdateAsync(int projectId, string name, int templateId, CancellationToken ct = default);
    Task                DeleteAsync(int projectId, CancellationToken ct = default);
}

/// <summary>
/// CRUD de versões/simulações.
/// </summary>
public interface IVersionRepository
{
    Task<VersionEntity?> GetByIdAsync(int versionId, CancellationToken ct = default);
    Task<IReadOnlyList<VersionEntity>> GetByProjectIdAsync(int projectId, CancellationToken ct = default);
    Task<IReadOnlyList<VersionTypeEntity>> GetAllVersionTypesAsync(CancellationToken ct = default);
    Task<VersionTypeEntity?>               GetVersionTypeByIdAsync(int id, CancellationToken ct = default);
    Task<VersionTypeEntity>                CreateVersionTypeAsync(string code, string name, bool isLocked, int sortOrder, CancellationToken ct = default);
    Task<VersionTypeEntity>                UpdateVersionTypeAsync(int id, string code, string name, bool isLocked, int sortOrder, CancellationToken ct = default);
    Task                                   DeleteVersionTypeAsync(int id, CancellationToken ct = default);

    Task<VersionEntity> CreateAsync(
        int projectId, string code, string name, CancellationToken ct = default);

    Task<VersionEntity> CloneAsync(
        int fromVersionId, string code, string name, int? versionTypeId, CancellationToken ct = default);
}

/// <summary>
/// Leitura e escrita de valores de células.
/// Usa Dapper para máxima performance no carregamento bulk.
/// </summary>
public interface ICellRepository
{
    /// <summary>
    /// Carrega todas as células de uma versão num único query.
    /// Resultado usado como working set pelo CalculationSession.
    /// </summary>
    Task<Dictionary<CellKey, CellValue>> LoadVersionCellsAsync(
        int versionId, CancellationToken ct = default);

    /// <summary>
    /// Persiste a célula editada pelo utilizador (source='manual' ou 'imported')
    /// e o delta devolvido pelo motor (source='formula').
    /// Tudo numa única transacção.
    /// Escreve CalculationLog se a flag estiver activa.
    /// </summary>
    Task SaveEditAsync(
        CellKey editedKey,
        CellValue editedValue,
        IReadOnlyList<CalculatedCell> delta,
        Guid sessionId,
        CancellationToken ct = default);

    /// <summary>Verifica se o log de cálculo está activo (EngineConfig).</summary>
    Task<bool> IsCalculationLogEnabledAsync(CancellationToken ct = default);
}

public interface IVariableGroupRepository
{
    Task<IReadOnlyList<VariableGroupEntity>> GetAllAsync(CancellationToken ct = default);
    Task<IReadOnlyList<VariableGroupEntity>> GetByTemplateAsync(int templateId, CancellationToken ct = default);
    Task<VariableGroupEntity?>               GetByIdAsync(int groupId, CancellationToken ct = default);
    Task<VariableGroupEntity>                CreateAsync(int templateId, string code, string name, int sortOrder, CancellationToken ct = default);
    Task<VariableGroupEntity>                UpdateAsync(int groupId, string code, string name, int sortOrder, CancellationToken ct = default);
    Task                                     DeleteAsync(int groupId, CancellationToken ct = default);
}
