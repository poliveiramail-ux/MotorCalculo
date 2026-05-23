using Microsoft.EntityFrameworkCore;
using MotorCalculo.Infrastructure.Data;
using MotorCalculo.Infrastructure.Entities;
using MotorCalculo.Infrastructure.Repositories.Interfaces;

namespace MotorCalculo.Infrastructure.Repositories;

public sealed class VersionRepository(MotorCalculoDbContext db) : IVersionRepository
{
    public async Task<VersionEntity?> GetByIdAsync(int versionId, CancellationToken ct = default)
        => await db.Versions.AsNoTracking()
                             .FirstOrDefaultAsync(v => v.VersionId == versionId, ct);

    public async Task<IReadOnlyList<VersionEntity>> GetByProjectIdAsync(
        int projectId, CancellationToken ct = default)
        => await db.Versions.AsNoTracking()
                             .Where(v => v.ProjectId == projectId)
                             .OrderBy(v => v.CreatedAt)
                             .ToListAsync(ct);

    public async Task<VersionEntity> CreateAsync(
        int projectId, string code, string name, CancellationToken ct = default)
    {
        var version = new VersionEntity
        {
            ProjectId  = projectId,
            Code       = code,
            Name       = name,
            CreatedAt  = DateTime.UtcNow,
        };
        db.Versions.Add(version);
        await db.SaveChangesAsync(ct);
        return version;
    }

    /// <summary>
    /// Clona uma versão:
    ///  1. Cria a nova VersionEntity com ClonedFromId
    ///  2. Copia todos os CellValues da versão de origem para a nova
    /// Executado em transacção — atómico.
    /// </summary>
    public async Task<VersionEntity> CloneAsync(
        int fromVersionId, string code, string name, CancellationToken ct = default)
    {
        // SqlServerRetryingExecutionStrategy não suporta transacções manuais directas.
        // É necessário envolver a transacção em CreateExecutionStrategy().ExecuteAsync().
        var strategy = db.Database.CreateExecutionStrategy();

        return await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            try
            {
                var source = await db.Versions
                    .AsNoTracking()
                    .FirstOrDefaultAsync(v => v.VersionId == fromVersionId, ct)
                    ?? throw new InvalidOperationException(
                        $"Versão de origem {fromVersionId} não encontrada.");

                // 1 — Cria nova versão
                var newVersion = new VersionEntity
                {
                    ProjectId    = source.ProjectId,
                    Code         = code,
                    Name         = name,
                    ClonedFromId = fromVersionId,
                    CreatedAt    = DateTime.UtcNow,
                };
                db.Versions.Add(newVersion);
                await db.SaveChangesAsync(ct);

                // 2 — Copia células via SQL directo (mais eficiente que EF Core para bulk insert)
                var sql = """
                    INSERT INTO dbo.CellValue
                        (version_id, year, month, variable_id, language_id, lob_id,
                         value, status, source, formula_id, imported_at, computed_at)
                    SELECT
                        {0}, year, month, variable_id, language_id, lob_id,
                        value, status, source, formula_id, imported_at, computed_at
                    FROM dbo.CellValue
                    WHERE version_id = {1}
                    """;

                await db.Database.ExecuteSqlRawAsync(sql, new object[] { newVersion.VersionId, fromVersionId }, ct);
                await tx.CommitAsync(ct);

                return newVersion;
            }
            catch
            {
                await tx.RollbackAsync(ct);
                throw;
            }
        });
    }
}
