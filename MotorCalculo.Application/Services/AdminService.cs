using MotorCalculo.Application.DTOs;
using MotorCalculo.Infrastructure.Repositories.Interfaces;

namespace MotorCalculo.Application.Services;

/// <summary>Serviço de administração — CRUD de tipos de versão, grupos, templates e projectos.</summary>
public sealed class AdminService(
    IVersionRepository       versionRepo,
    IVariableGroupRepository groupRepo,
    ITemplateRepository      templateRepo,
    IProjectRepository       projectRepo)
{
    // ═══════════════════════════════════════════════════════════
    //  Tipos de Versão
    // ═══════════════════════════════════════════════════════════

    public async Task<IReadOnlyList<VersionTypeDto>> GetVersionTypesAsync(CancellationToken ct = default)
    {
        var types = await versionRepo.GetAllVersionTypesAsync(ct);
        return types.Select(MapType).ToList();
    }

    public async Task<VersionTypeDto> CreateVersionTypeAsync(UpsertVersionTypeRequest req, CancellationToken ct = default)
    {
        var e = await versionRepo.CreateVersionTypeAsync(req.Code, req.Name, req.IsLocked, req.SortOrder, ct);
        return MapType(e);
    }

    public async Task<VersionTypeDto> UpdateVersionTypeAsync(int id, UpsertVersionTypeRequest req, CancellationToken ct = default)
    {
        var e = await versionRepo.UpdateVersionTypeAsync(id, req.Code, req.Name, req.IsLocked, req.SortOrder, ct);
        return MapType(e);
    }

    public Task DeleteVersionTypeAsync(int id, CancellationToken ct = default)
        => versionRepo.DeleteVersionTypeAsync(id, ct);

    private static VersionTypeDto MapType(Infrastructure.Entities.VersionTypeEntity e) =>
        new(e.VersionTypeId, e.Code, e.Name, e.IsLocked, e.SortOrder);

    // ═══════════════════════════════════════════════════════════
    //  Grupos de Variáveis
    // ═══════════════════════════════════════════════════════════

    public async Task<IReadOnlyList<VariableGroupDto>> GetAllGroupsAsync(CancellationToken ct = default)
    {
        var groups = await groupRepo.GetAllAsync(ct);
        return groups.Select(g => new VariableGroupDto(
            g.GroupId, g.TemplateId, g.Template?.Name ?? "", g.Code, g.Name, g.SortOrder, g.Variables.Count
        )).ToList();
    }

    public async Task<VariableGroupDto> CreateGroupAsync(UpsertVariableGroupRequest req, CancellationToken ct = default)
    {
        var e = await groupRepo.CreateAsync(req.TemplateId, req.Code, req.Name, req.SortOrder, ct);
        return new VariableGroupDto(e.GroupId, e.TemplateId, "", e.Code, e.Name, e.SortOrder, 0);
    }

    public async Task<VariableGroupDto> UpdateGroupAsync(int id, UpsertVariableGroupRequest req, CancellationToken ct = default)
    {
        var e    = await groupRepo.UpdateAsync(id, req.Code, req.Name, req.SortOrder, ct);
        var full = await groupRepo.GetByIdAsync(id, ct);
        return new VariableGroupDto(e.GroupId, e.TemplateId, "", e.Code, e.Name, e.SortOrder, full?.Variables.Count ?? 0);
    }

    public Task DeleteGroupAsync(int id, CancellationToken ct = default)
        => groupRepo.DeleteAsync(id, ct);

    // ═══════════════════════════════════════════════════════════
    //  Templates
    // ═══════════════════════════════════════════════════════════

    public async Task<IReadOnlyList<AdminTemplateDto>> GetAllTemplatesAsync(CancellationToken ct = default)
    {
        var templates = await templateRepo.GetAllAsync(ct);
        return templates.Select(MapTemplate).ToList();
    }

    public async Task<AdminTemplateDto> CreateTemplateAsync(UpsertTemplateRequest req, CancellationToken ct = default)
    {
        var e = await templateRepo.CreateAsync(req.Code, req.Name, req.Description, ct);
        return MapTemplate(e);
    }

    public async Task<AdminTemplateDto> UpdateTemplateAsync(int id, UpsertTemplateRequest req, CancellationToken ct = default)
    {
        var e = await templateRepo.UpdateAsync(id, req.Code, req.Name, req.Description, ct);
        return MapTemplate(e);
    }

    public Task DeleteTemplateAsync(int id, CancellationToken ct = default)
        => templateRepo.DeleteAsync(id, ct);

    private static AdminTemplateDto MapTemplate(Infrastructure.Entities.TemplateEntity e) =>
        new(e.TemplateId, e.Code, e.Name, e.Description, e.CreatedAt, e.UpdatedAt);

    // ═══════════════════════════════════════════════════════════
    //  Projectos
    // ═══════════════════════════════════════════════════════════

    public async Task<IReadOnlyList<AdminProjectDto>> GetAllProjectsAsync(CancellationToken ct = default)
    {
        var projects = await projectRepo.GetAllAsync(ct);
        // Load template names
        var templates = await templateRepo.GetAllAsync(ct);
        var tplMap    = templates.ToDictionary(t => t.TemplateId, t => t.Name);
        return projects.Select(p => new AdminProjectDto(
            p.ProjectId, p.TemplateId, tplMap.GetValueOrDefault(p.TemplateId, ""), p.Code, p.Name, p.CreatedAt
        )).ToList();
    }

    public async Task<AdminProjectDto> CreateProjectAsync(UpsertProjectRequest req, CancellationToken ct = default)
    {
        var e       = await projectRepo.CreateAsync(req.TemplateId, req.Code, req.Name, ct);
        var templates = await templateRepo.GetAllAsync(ct);
        var tplName = templates.FirstOrDefault(t => t.TemplateId == req.TemplateId)?.Name ?? "";
        return new AdminProjectDto(e.ProjectId, e.TemplateId, tplName, e.Code, e.Name, e.CreatedAt);
    }

    public async Task<AdminProjectDto> UpdateProjectAsync(int id, UpsertProjectRequest req, CancellationToken ct = default)
    {
        var e         = await projectRepo.UpdateAsync(id, req.Name, req.TemplateId, ct);
        var templates = await templateRepo.GetAllAsync(ct);
        var tplName   = templates.FirstOrDefault(t => t.TemplateId == req.TemplateId)?.Name ?? "";
        return new AdminProjectDto(e.ProjectId, e.TemplateId, tplName, e.Code, e.Name, e.CreatedAt);
    }

    public Task DeleteProjectAsync(int id, CancellationToken ct = default)
        => projectRepo.DeleteAsync(id, ct);
}
