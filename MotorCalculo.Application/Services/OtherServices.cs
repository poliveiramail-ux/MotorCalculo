using MotorCalculo.Application.DTOs;
using MotorCalculo.Application.Exceptions;
using MotorCalculo.Infrastructure.Entities;
using MotorCalculo.Infrastructure.Repositories.Interfaces;

namespace MotorCalculo.Application.Services;

// ─────────────────────────────────────────────────────────────
//  VersionService
// ─────────────────────────────────────────────────────────────

public sealed class VersionService(IVersionRepository versionRepo)
{
    public async Task<IReadOnlyList<VersionResponse>> GetByProjectAsync(
        int projectId, CancellationToken ct = default)
    {
        var versions = await versionRepo.GetByProjectIdAsync(projectId, ct);
        return versions.Select(Map).ToList();
    }

    public async Task<VersionResponse> GetByIdAsync(
        int versionId, CancellationToken ct = default)
    {
        var version = await versionRepo.GetByIdAsync(versionId, ct)
            ?? throw new NotFoundException("Version", versionId);
        return Map(version);
    }

    public async Task<VersionResponse> CreateAsync(
        CreateVersionRequest request, CancellationToken ct = default)
    {
        var version = await versionRepo.CreateAsync(
            request.ProjectId, request.Code, request.Name, ct);
        return Map(version);
    }

    public async Task<VersionResponse> CloneAsync(
        CloneVersionRequest request, CancellationToken ct = default)
    {
        var version = await versionRepo.CloneAsync(
            request.FromVersionId, request.Code, request.Name, ct);
        return Map(version);
    }

    private static VersionResponse Map(VersionEntity v) => new(
        v.VersionId, v.ProjectId, v.Code, v.Name,
        v.ClonedFromId, v.ColorIndex, v.CreatedAt);
}

// ─────────────────────────────────────────────────────────────
//  TemplateService
// ─────────────────────────────────────────────────────────────

public sealed class TemplateService(ITemplateRepository templateRepo)
{
    public async Task<IReadOnlyList<TemplateResponse>> GetAllAsync(
        CancellationToken ct = default)
    {
        var templates = await templateRepo.GetAllAsync(ct);
        return templates.Select(t => new TemplateResponse(t.TemplateId, t.Code, t.Name)).ToList();
    }

    public async Task<IReadOnlyList<VariableResponse>> GetVariablesAsync(
        int templateId, CancellationToken ct = default)
    {
        _ = await templateRepo.GetByIdAsync(templateId, ct)
            ?? throw new NotFoundException("Template", templateId);

        var variables = await templateRepo.GetVariableDefinitionsAsync(templateId, ct);

        return variables.Select(v => new VariableResponse(
            VariableId:    v.VariableId,
            Code:          v.Code,
            Name:          v.Name,
            ScopeCode:     v.ScopeCode,
            IsInput:       v.IsInput,
            ExternalField: v.ExternalField,
            SortOrder:     0,
            GroupId:       null,
            Formulas:      v.Formulas.Select(f => new FormulaResponse(
                f.FormulaId, f.FormulaType, f.Expression, f.TriggerVariableId
            )).ToList()
        )).ToList();
    }
}

// ─────────────────────────────────────────────────────────────
//  ProjectService
// ─────────────────────────────────────────────────────────────

public sealed class ProjectService(IProjectRepository projectRepo)
{
    public async Task<IReadOnlyList<ProjectResponse>> GetAllAsync(
        CancellationToken ct = default)
    {
        var projects = await projectRepo.GetAllAsync(ct);
        return projects.Select(p =>
            new ProjectResponse(p.ProjectId, p.TemplateId, p.Code, p.Name)).ToList();
    }

    public async Task<ProjectResponse> GetByIdAsync(
        int projectId, CancellationToken ct = default)
    {
        var project = await projectRepo.GetByIdAsync(projectId, ct)
            ?? throw new NotFoundException("Project", projectId);
        return new ProjectResponse(project.ProjectId, project.TemplateId, project.Code, project.Name);
    }

    public async Task<ProjectStructureResponse> GetStructureAsync(
        int projectId, CancellationToken ct = default)
    {
        var structure = await projectRepo.GetStructureAsync(projectId, ct)
            ?? throw new NotFoundException("ProjectStructure", projectId);

        return new ProjectStructureResponse(
            structure.ProjectId,
            structure.Languages.Select(l => new LanguageResponse(
                l.LanguageId, l.Code, l.Name,
                l.Lobs.Select(b => new LobResponse(b.LobId, b.Code, b.Name)).ToList()
            )).ToList()
        );
    }
}
