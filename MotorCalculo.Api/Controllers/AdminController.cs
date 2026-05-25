using Microsoft.AspNetCore.Mvc;
using MotorCalculo.Application.DTOs;
using MotorCalculo.Application.Services;

namespace MotorCalculo.Api.Controllers;

[ApiController]
[Route("api/admin")]
public sealed class AdminController(AdminService adminService) : ControllerBase
{
    // ── Tipos de Versão ───────────────────────────────────────

    [HttpGet("version-types")]
    public async Task<IActionResult> GetVersionTypes(CancellationToken ct)
        => Ok(await adminService.GetVersionTypesAsync(ct));

    [HttpPost("version-types")]
    public async Task<IActionResult> CreateVersionType([FromBody] UpsertVersionTypeRequest req, CancellationToken ct)
        => Ok(await adminService.CreateVersionTypeAsync(req, ct));

    [HttpPut("version-types/{id:int}")]
    public async Task<IActionResult> UpdateVersionType(int id, [FromBody] UpsertVersionTypeRequest req, CancellationToken ct)
        => Ok(await adminService.UpdateVersionTypeAsync(id, req, ct));

    [HttpDelete("version-types/{id:int}")]
    public async Task<IActionResult> DeleteVersionType(int id, CancellationToken ct)
    {
        await adminService.DeleteVersionTypeAsync(id, ct);
        return NoContent();
    }

    // ── Grupos de Variáveis ───────────────────────────────────

    [HttpGet("groups")]
    public async Task<IActionResult> GetGroups(CancellationToken ct)
        => Ok(await adminService.GetAllGroupsAsync(ct));

    [HttpPost("groups")]
    public async Task<IActionResult> CreateGroup([FromBody] UpsertVariableGroupRequest req, CancellationToken ct)
        => Ok(await adminService.CreateGroupAsync(req, ct));

    [HttpPut("groups/{id:int}")]
    public async Task<IActionResult> UpdateGroup(int id, [FromBody] UpsertVariableGroupRequest req, CancellationToken ct)
        => Ok(await adminService.UpdateGroupAsync(id, req, ct));

    [HttpDelete("groups/{id:int}")]
    public async Task<IActionResult> DeleteGroup(int id, CancellationToken ct)
    {
        await adminService.DeleteGroupAsync(id, ct);
        return NoContent();
    }

    // ── Templates ─────────────────────────────────────────────

    [HttpGet("templates")]
    public async Task<IActionResult> GetTemplates(CancellationToken ct)
        => Ok(await adminService.GetAllTemplatesAsync(ct));

    [HttpPost("templates")]
    public async Task<IActionResult> CreateTemplate([FromBody] UpsertTemplateRequest req, CancellationToken ct)
        => Ok(await adminService.CreateTemplateAsync(req, ct));

    [HttpPut("templates/{id:int}")]
    public async Task<IActionResult> UpdateTemplate(int id, [FromBody] UpsertTemplateRequest req, CancellationToken ct)
        => Ok(await adminService.UpdateTemplateAsync(id, req, ct));

    [HttpDelete("templates/{id:int}")]
    public async Task<IActionResult> DeleteTemplate(int id, CancellationToken ct)
    {
        await adminService.DeleteTemplateAsync(id, ct);
        return NoContent();
    }

    // ── Projectos ─────────────────────────────────────────────

    [HttpGet("projects")]
    public async Task<IActionResult> GetProjects(CancellationToken ct)
        => Ok(await adminService.GetAllProjectsAsync(ct));

    [HttpPost("projects")]
    public async Task<IActionResult> CreateProject([FromBody] UpsertProjectRequest req, CancellationToken ct)
        => Ok(await adminService.CreateProjectAsync(req, ct));

    [HttpPut("projects/{id:int}")]
    public async Task<IActionResult> UpdateProject(int id, [FromBody] UpsertProjectRequest req, CancellationToken ct)
        => Ok(await adminService.UpdateProjectAsync(id, req, ct));

    [HttpDelete("projects/{id:int}")]
    public async Task<IActionResult> DeleteProject(int id, CancellationToken ct)
    {
        await adminService.DeleteProjectAsync(id, ct);
        return NoContent();
    }
}
