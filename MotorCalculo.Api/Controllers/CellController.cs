using Microsoft.AspNetCore.Mvc;
using MotorCalculo.Application.DTOs;
using MotorCalculo.Application.Services;

namespace MotorCalculo.Api.Controllers;

[ApiController]
[Route("api/versions/{versionId:int}/cells")]
public sealed class CellController(CellService cellService) : ControllerBase
{
    /// <summary>
    /// Carrega todas as células de uma versão.
    /// Chamado quando o frontend abre uma versão pela primeira vez.
    /// </summary>
    [HttpGet]
    [ProducesResponseType(typeof(LoadVersionResponse), 200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> GetCells(int versionId, CancellationToken ct)
    {
        var result = await cellService.LoadVersionCellsAsync(versionId, ct);
        return Ok(result);
    }

    /// <summary>
    /// Edita uma célula e devolve apenas as células que o motor recalculou (delta).
    /// O frontend actualiza só essas células — não recarrega a grelha inteira.
    ///
    /// PATCH em vez de PUT porque a operação é parcial:
    /// só uma célula é editada, o resto é calculado automaticamente.
    /// </summary>
    [HttpPatch]
    [ProducesResponseType(typeof(EditCellResponse), 200)]
    [ProducesResponseType(400)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> EditCell(
        int versionId,
        [FromBody] EditCellBody body,
        CancellationToken ct)
    {
        var request = new EditCellRequest(
            versionId,
            body.VariableId,
            body.LanguageId,
            body.LobId,
            body.Year,
            body.Month,
            body.Value,
            body.Source ?? "manual");

        var result = await cellService.EditCellAsync(request, ct);
        return Ok(result);
    }
}

/// <summary>
/// Body do PATCH /cells — versionId vem da rota.
/// </summary>
public sealed record EditCellBody(
    int      VariableId,
    int?     LanguageId,
    int?     LobId,
    int      Year,
    int      Month,
    decimal? Value,
    string?  Source    // "manual" | "imported" — omitido assume "manual"
);
