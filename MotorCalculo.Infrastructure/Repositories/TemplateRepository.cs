using Microsoft.EntityFrameworkCore;
using MotorCalculo.Engine.Models;
using MotorCalculo.Infrastructure.Data;
using MotorCalculo.Infrastructure.Entities;
using MotorCalculo.Infrastructure.Repositories.Interfaces;

namespace MotorCalculo.Infrastructure.Repositories;

// ─────────────────────────────────────────────────────────────
//  TemplateRepository
// ─────────────────────────────────────────────────────────────

public sealed class TemplateRepository(MotorCalculoDbContext db) : ITemplateRepository
{
    public async Task<TemplateEntity?> GetByIdAsync(int templateId, CancellationToken ct = default)
        => await db.Templates.AsNoTracking()
                              .FirstOrDefaultAsync(t => t.TemplateId == templateId, ct);

    public async Task<IReadOnlyList<TemplateEntity>> GetAllAsync(CancellationToken ct = default)
        => await db.Templates.AsNoTracking()
                              .OrderBy(t => t.Name)
                              .ToListAsync(ct);

    /// <summary>
    /// Carrega variáveis + fórmulas do template e mapeia para os tipos do Engine.
    /// Include encadeado: Variable → Formulas (todas as alternativas).
    /// </summary>
    public async Task<IReadOnlyList<VariableDefinition>> GetVariableDefinitionsAsync(
        int templateId, CancellationToken ct = default)
    {
        var variables = await db.Variables
            .AsNoTracking()
            .Where(v => v.TemplateId == templateId)
            .Include(v => v.Formulas)
            .Include(v => v.Group)
            .OrderBy(v => v.Group!.SortOrder)
            .ThenBy(v => v.SortOrder)
            .ToListAsync(ct);

        return variables.Select(MapToDefinition).ToList();
    }

    // ── Mapeamento entidade → modelo do Engine ────────────────

    private static VariableDefinition MapToDefinition(VariableEntity entity) => new()
    {
        VariableId    = entity.VariableId,
        Code          = entity.Code,
        Name          = entity.Name,
        ScopeCode     = entity.ScopeCode,
        IsInput       = entity.IsInput,
        ExternalField = entity.ExternalField,
        GroupId       = entity.GroupId,
        GroupName     = entity.Group?.Name,
        GroupOrder    = entity.Group?.SortOrder ?? 999,
        SortOrder     = entity.SortOrder,
        Formulas      = entity.Formulas
                              .OrderBy(f => f.SortOrder)
                              .Select(MapToFormula)
                              .ToList()
    };

    private static FormulaDefinition MapToFormula(FormulaEntity entity) => new()
    {
        FormulaId         = entity.FormulaId,
        FormulaType       = entity.FormulaType,
        Expression        = entity.Expression,
        TriggerVariableId = entity.TriggerVariableId,
        SortOrder         = entity.SortOrder,
    };

    public async Task<TemplateEntity> CreateAsync(
        string code, string name, string? description, CancellationToken ct = default)
    {
        var entity = new TemplateEntity
        {
            Code = code, Name = name, Description = description,
            CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow
        };
        db.Templates.Add(entity);
        await db.SaveChangesAsync(ct);
        return entity;
    }

    public async Task<TemplateEntity> UpdateAsync(
        int templateId, string code, string name, string? description, CancellationToken ct = default)
    {
        var entity = await db.Templates.FindAsync([templateId], ct)
            ?? throw new KeyNotFoundException($"Template {templateId} not found.");
        entity.Code = code; entity.Name = name;
        entity.Description = description; entity.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return entity;
    }

    public async Task DeleteAsync(int templateId, CancellationToken ct = default)
    {
        var entity = await db.Templates.FindAsync([templateId], ct)
            ?? throw new KeyNotFoundException($"Template {templateId} not found.");
        db.Templates.Remove(entity);
        await db.SaveChangesAsync(ct);
    }
}

// ─────────────────────────────────────────────────────────────
//  ProjectRepository
// ─────────────────────────────────────────────────────────────

public sealed class ProjectRepository(MotorCalculoDbContext db) : IProjectRepository
{
    public async Task<ProjectEntity?> GetByIdAsync(int projectId, CancellationToken ct = default)
        => await db.Projects.AsNoTracking()
                             .FirstOrDefaultAsync(p => p.ProjectId == projectId, ct);

    public async Task<IReadOnlyList<ProjectEntity>> GetAllAsync(CancellationToken ct = default)
        => await db.Projects.AsNoTracking()
                             .Where(p => db.Versions.Any(v => v.ProjectId == p.ProjectId))
                             .OrderBy(p => p.Name)
                             .ToListAsync(ct);

    /// <summary>
    /// Carrega a hierarquia completa língua → LOB e mapeia para ProjectStructure do Engine.
    /// Um único query com Include encadeado.
    /// </summary>
    public async Task<ProjectStructure?> GetStructureAsync(int projectId, CancellationToken ct = default)
    {
        var project = await db.Projects
            .AsNoTracking()
            .Where(p => p.ProjectId == projectId)
            .Include(p => p.Languages.OrderBy(l => l.SortOrder))
                .ThenInclude(l => l.Lobs.OrderBy(b => b.SortOrder))
            .FirstOrDefaultAsync(ct);

        if (project is null) return null;

        return new ProjectStructure
        {
            ProjectId = project.ProjectId,
            Languages = project.Languages.Select(l => new LanguageDefinition
            {
                LanguageId = l.LanguageId,
                Code       = l.Code,
                Name       = l.Name,
                Lobs       = l.Lobs.Select(b => new LobDefinition
                {
                    LobId = b.LobId,
                    Code  = b.Code,
                    Name  = b.Name,
                }).ToList()
            }).ToList()
        };
    }

    public async Task<ProjectEntity> CreateAsync(
        int templateId, string code, string name, CancellationToken ct = default)
    {
        var project = new ProjectEntity
        {
            TemplateId = templateId,
            Code       = code,
            Name       = name,
            CreatedAt  = DateTime.UtcNow,
        };
        db.Projects.Add(project);
        await db.SaveChangesAsync(ct);
        return project;
    }

    public async Task<ProjectEntity> UpdateAsync(
        int projectId, string name, int templateId, CancellationToken ct = default)
    {
        var entity = await db.Projects.FindAsync([projectId], ct)
            ?? throw new KeyNotFoundException($"Project {projectId} not found.");
        entity.Name = name; entity.TemplateId = templateId;
        await db.SaveChangesAsync(ct);
        return entity;
    }

    public async Task DeleteAsync(int projectId, CancellationToken ct = default)
    {
        var entity = await db.Projects.FindAsync([projectId], ct)
            ?? throw new KeyNotFoundException($"Project {projectId} not found.");
        db.Projects.Remove(entity);
        await db.SaveChangesAsync(ct);
    }
}
