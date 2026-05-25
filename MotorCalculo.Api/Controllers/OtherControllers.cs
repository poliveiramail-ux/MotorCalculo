using Microsoft.AspNetCore.Mvc;
using MotorCalculo.Application.DTOs;
using MotorCalculo.Application.Services;

namespace MotorCalculo.Api.Controllers;

// ─────────────────────────────────────────────────────────────
//  VersionController
// ─────────────────────────────────────────────────────────────

[ApiController]
[Route("api/versions")]
public sealed class VersionController(VersionService versionService) : ControllerBase
{
    /// <summary>GET /api/versions?projectId=1</summary>
    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<VersionResponse>), 200)]
    public async Task<IActionResult> GetByProject([FromQuery] int projectId, CancellationToken ct)
    {
        var versions = await versionService.GetByProjectAsync(projectId, ct);
        return Ok(versions);
    }

    /// <summary>GET /api/versions/5</summary>
    [HttpGet("{id:int}")]
    [ProducesResponseType(typeof(VersionResponse), 200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> GetById(int id, CancellationToken ct)
    {
        var version = await versionService.GetByIdAsync(id, ct);
        return Ok(version);
    }

    /// <summary>POST /api/versions — criar nova versão</summary>
    [HttpPost]
    [ProducesResponseType(typeof(VersionResponse), 201)]
    public async Task<IActionResult> Create([FromBody] CreateVersionRequest request, CancellationToken ct)
    {
        var version = await versionService.CreateAsync(request, ct);
        return CreatedAtAction(nameof(GetById), new { id = version.VersionId }, version);
    }

    /// <summary>GET /api/version-types — lista de tipos de versão</summary>
    [HttpGet("/api/version-types")]
    [ProducesResponseType(typeof(IReadOnlyList<VersionTypeDto>), 200)]
    public async Task<IActionResult> GetVersionTypes(CancellationToken ct)
    {
        var types = await versionService.GetVersionTypesAsync(ct);
        return Ok(types);
    }

    /// <summary>POST /api/versions/clone — clonar versão existente</summary>
    [HttpPost("clone")]
    [ProducesResponseType(typeof(VersionResponse), 201)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> Clone([FromBody] CloneVersionRequest request, CancellationToken ct)
    {
        var version = await versionService.CloneAsync(request, ct);
        return CreatedAtAction(nameof(GetById), new { id = version.VersionId }, version);
    }
}

// ─────────────────────────────────────────────────────────────
//  TemplateController
// ─────────────────────────────────────────────────────────────

[ApiController]
[Route("api/templates")]
public sealed class TemplateController(TemplateService templateService) : ControllerBase
{
    /// <summary>GET /api/templates</summary>
    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<TemplateResponse>), 200)]
    public async Task<IActionResult> GetAll(CancellationToken ct)
    {
        var templates = await templateService.GetAllAsync(ct);
        return Ok(templates);
    }

    /// <summary>GET /api/templates/1/variables</summary>
    [HttpGet("{id:int}/variables")]
    [ProducesResponseType(typeof(IReadOnlyList<VariableResponse>), 200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> GetVariables(int id, CancellationToken ct)
    {
        var variables = await templateService.GetVariablesAsync(id, ct);
        return Ok(variables);
    }
}

// ─────────────────────────────────────────────────────────────
//  ProjectController
// ─────────────────────────────────────────────────────────────

[ApiController]
[Route("api/projects")]
public sealed class ProjectController(ProjectService projectService) : ControllerBase
{
    /// <summary>GET /api/projects</summary>
    [HttpGet]
    [ProducesResponseType(typeof(IReadOnlyList<ProjectResponse>), 200)]
    public async Task<IActionResult> GetAll(CancellationToken ct)
    {
        var projects = await projectService.GetAllAsync(ct);
        return Ok(projects);
    }

    /// <summary>GET /api/projects/1</summary>
    [HttpGet("{id:int}")]
    [ProducesResponseType(typeof(ProjectResponse), 200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> GetById(int id, CancellationToken ct)
    {
        var project = await projectService.GetByIdAsync(id, ct);
        return Ok(project);
    }

    /// <summary>
    /// GET /api/projects/1/structure
    /// Devolve línguas + LOBs — necessário para o frontend construir a grelha.
    /// </summary>
    [HttpGet("{id:int}/structure")]
    [ProducesResponseType(typeof(ProjectStructureResponse), 200)]
    [ProducesResponseType(404)]
    public async Task<IActionResult> GetStructure(int id, CancellationToken ct)
    {
        var structure = await projectService.GetStructureAsync(id, ct);
        return Ok(structure);
    }
}
