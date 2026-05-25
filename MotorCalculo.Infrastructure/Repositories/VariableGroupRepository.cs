using Microsoft.EntityFrameworkCore;
using MotorCalculo.Infrastructure.Data;
using MotorCalculo.Infrastructure.Entities;
using MotorCalculo.Infrastructure.Repositories.Interfaces;

namespace MotorCalculo.Infrastructure.Repositories;

public sealed class VariableGroupRepository(MotorCalculoDbContext db) : IVariableGroupRepository
{
    public async Task<IReadOnlyList<VariableGroupEntity>> GetAllAsync(CancellationToken ct = default)
        => await db.VariableGroups
                   .AsNoTracking()
                   .Include(g => g.Variables)
                   .Include(g => g.Template)
                   .OrderBy(g => g.Template!.Name)
                   .ThenBy(g => g.SortOrder)
                   .ToListAsync(ct);

    public async Task<IReadOnlyList<VariableGroupEntity>> GetByTemplateAsync(
        int templateId, CancellationToken ct = default)
        => await db.VariableGroups
                   .AsNoTracking()
                   .Where(g => g.TemplateId == templateId)
                   .Include(g => g.Variables)
                   .Include(g => g.Template)
                   .OrderBy(g => g.SortOrder)
                   .ToListAsync(ct);

    public async Task<VariableGroupEntity?> GetByIdAsync(int groupId, CancellationToken ct = default)
        => await db.VariableGroups
                   .Include(g => g.Variables)
                   .FirstOrDefaultAsync(g => g.GroupId == groupId, ct);

    public async Task<VariableGroupEntity> CreateAsync(
        int templateId, string code, string name, int sortOrder, CancellationToken ct = default)
    {
        var entity = new VariableGroupEntity
        {
            TemplateId = templateId, Code = code, Name = name, SortOrder = sortOrder
        };
        db.VariableGroups.Add(entity);
        await db.SaveChangesAsync(ct);
        return entity;
    }

    public async Task<VariableGroupEntity> UpdateAsync(
        int groupId, string code, string name, int sortOrder, CancellationToken ct = default)
    {
        var entity = await db.VariableGroups.FindAsync([groupId], ct)
            ?? throw new KeyNotFoundException($"VariableGroup {groupId} not found.");
        entity.Code = code; entity.Name = name; entity.SortOrder = sortOrder;
        await db.SaveChangesAsync(ct);
        return entity;
    }

    public async Task DeleteAsync(int groupId, CancellationToken ct = default)
    {
        var entity = await db.VariableGroups.FindAsync([groupId], ct)
            ?? throw new KeyNotFoundException($"VariableGroup {groupId} not found.");
        db.VariableGroups.Remove(entity);
        await db.SaveChangesAsync(ct);
    }
}
