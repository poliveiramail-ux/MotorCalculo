using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using MotorCalculo.Engine.Models;
using MotorCalculo.Engine.Session;
using MotorCalculo.Infrastructure.Data;
using MotorCalculo.Infrastructure.Repositories.Interfaces;

namespace MotorCalculo.Infrastructure.Repositories;

/// <summary>
/// Repositório de células — usa Dapper para todas as operações.
/// EF Core seria demasiado lento para carregar/gravar dezenas de milhares de linhas.
///
/// Padrão de upsert escolhido:
///   UPDATE → se 0 rows → INSERT
///   Simples, legível, correcto para deltas pequenos (dezenas de células).
/// </summary>
public sealed class CellRepository(MotorCalculoDbContext db) : ICellRepository
{
    // ── Leitura bulk ──────────────────────────────────────────

    /// <summary>
    /// Carrega todas as células de uma versão num único query Dapper.
    /// Retorna o dicionário que o CalculationSession usa como working set.
    /// </summary>
    public async Task<Dictionary<CellKey, CellValue>> LoadVersionCellsAsync(
        int versionId, CancellationToken ct = default)
    {
        const string sql = """
            SELECT
                version_id   AS VersionId,
                year         AS Year,
                month        AS Month,
                variable_id  AS VariableId,
                language_id  AS LanguageId,
                lob_id       AS LobId,
                value        AS Value,
                status       AS Status,
                source       AS Source,
                formula_id   AS FormulaId
            FROM dbo.CellValue
            WHERE version_id = @versionId
            """;

        await using var conn = CreateConnection();
        var rows = await conn.QueryAsync<CellRow>(
            sql,
            new { versionId },
            commandTimeout: 120);

        return rows.ToDictionary(
            r => new CellKey(r.VersionId, r.Year, r.Month, r.VariableId, r.LanguageId, r.LobId),
            r => MapToValue(r));
    }

    // ── Escrita do delta ──────────────────────────────────────

    /// <summary>
    /// Persiste numa única transacção:
    ///   1. A célula editada pelo utilizador (trigger)
    ///   2. Todas as células do delta (calculadas pelo motor)
    ///   3. CalculationLog (se activo)
    /// </summary>
    public async Task SaveEditAsync(
        CellKey editedKey,
        CellValue editedValue,
        IReadOnlyList<CalculatedCell> delta,
        Guid sessionId,
        CancellationToken ct = default)
    {
        await using var conn = CreateConnection();
        await conn.OpenAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(ct);

        try
        {
            var now = DateTime.UtcNow;

            // 1 — Célula editada (input manual ou importado)
            await UpsertCellAsync(conn, tx, editedKey, editedValue, now);

            // 2 — Delta (células calculadas pelo motor)
            foreach (var cell in delta)
                await UpsertCellAsync(conn, tx, cell.Key, cell.After, now);

            // 3 — CalculationLog (se activo)
            if (await IsLogEnabledAsync(conn, tx))
            {
                var triggerType = editedValue.Source == CellSource.Imported ? "imported" : "input";
                await WriteLogAsync(conn, tx, sessionId, now, editedKey, triggerType, delta);
            }

            await tx.CommitAsync(ct);
        }
        catch
        {
            await tx.RollbackAsync(ct);
            throw;
        }
    }

    // ── CalculationLog flag ───────────────────────────────────

    public async Task<bool> IsCalculationLogEnabledAsync(CancellationToken ct = default)
    {
        await using var conn = CreateConnection();
        var val = await conn.ExecuteScalarAsync<string?>(
            "SELECT [value] FROM dbo.EngineConfig WHERE [key] = 'calculation_log_enabled'");
        return string.Equals(val, "true", StringComparison.OrdinalIgnoreCase);
    }

    // ── Private helpers ───────────────────────────────────────

    private async Task UpsertCellAsync(
        SqlConnection conn, IDbTransaction tx,
        CellKey key, CellValue value, DateTime now)
    {
        const string sql = """
            UPDATE dbo.CellValue
            SET
                value       = @value,
                status      = @status,
                source      = @source,
                formula_id  = @formulaId,
                computed_at = CASE WHEN @source = 'formula'   THEN @now ELSE computed_at END,
                imported_at = CASE WHEN @source = 'imported'  THEN @now ELSE imported_at END
            WHERE
                version_id  = @versionId
                AND year       = @year
                AND month      = @month
                AND variable_id = @variableId
                AND (language_id = @languageId OR (language_id IS NULL AND @languageId IS NULL))
                AND (lob_id     = @lobId      OR (lob_id     IS NULL AND @lobId      IS NULL));

            IF @@ROWCOUNT = 0
            BEGIN
                INSERT INTO dbo.CellValue
                    (version_id, year, month, variable_id, language_id, lob_id,
                     value, status, source, formula_id, computed_at, imported_at)
                VALUES
                    (@versionId, @year, @month, @variableId, @languageId, @lobId,
                     @value, @status, @source, @formulaId,
                     CASE WHEN @source = 'formula'  THEN @now ELSE NULL END,
                     CASE WHEN @source = 'imported' THEN @now ELSE NULL END);
            END
            """;

        await conn.ExecuteAsync(sql, new
        {
            versionId  = key.VersionId,
            year       = key.Year,
            month      = key.Month,
            variableId = key.VariableId,
            languageId = key.LanguageId,
            lobId      = key.LobId,
            value      = value.Value,
            status     = StatusToString(value.Status),
            source     = SourceToString(value.Source),
            formulaId  = value.FormulaId,
            now,
        }, transaction: tx);
    }

    private static async Task WriteLogAsync(
        SqlConnection conn, IDbTransaction tx,
        Guid sessionId, DateTime sessionAt,
        CellKey editedKey, string triggerType,
        IReadOnlyList<CalculatedCell> delta)
    {
        const string sql = """
            INSERT INTO dbo.CalculationLog
                (session_id, session_at, version_id, year, month, variable_id,
                 language_id, lob_id, step, trigger_type, trigger_variable_id,
                 formula_id, expression_used,
                 value_before, value_after, status_before, status_after)
            VALUES
                (@sessionId, @sessionAt, @versionId, @year, @month, @variableId,
                 @languageId, @lobId, @step, @triggerType, @triggerVariableId,
                 @formulaId, @expressionUsed,
                 @valueBefore, @valueAfter, @statusBefore, @statusAfter)
            """;

        foreach (var cell in delta)
        {
            await conn.ExecuteAsync(sql, new
            {
                sessionId,
                sessionAt,
                versionId         = cell.Key.VersionId,
                year              = cell.Key.Year,
                month             = cell.Key.Month,
                variableId        = cell.Key.VariableId,
                languageId        = cell.Key.LanguageId,
                lobId             = cell.Key.LobId,
                step              = cell.Step,
                triggerType,
                triggerVariableId = editedKey.VariableId,
                formulaId         = cell.After.FormulaId,
                expressionUsed    = cell.ExpressionUsed,
                valueBefore       = cell.Before.Value,
                valueAfter        = cell.After.Value,
                statusBefore      = StatusToString(cell.Before.Status),
                statusAfter       = StatusToString(cell.After.Status),
            }, transaction: tx);
        }
    }

    private static async Task<bool> IsLogEnabledAsync(SqlConnection conn, IDbTransaction tx)
    {
        var val = await conn.ExecuteScalarAsync<string?>(
            "SELECT [value] FROM dbo.EngineConfig WHERE [key] = 'calculation_log_enabled'",
            transaction: tx);
        return string.Equals(val, "true", StringComparison.OrdinalIgnoreCase);
    }

    private SqlConnection CreateConnection()
        => new(db.Database.GetConnectionString());

    // ── Conversão string ↔ enum ───────────────────────────────

    private static CellValue MapToValue(CellRow row) => new()
    {
        Value     = row.Value,
        Status    = row.Status switch
        {
            "ok"    => CellStatus.Ok,
            "error" => CellStatus.Error,
            _       => CellStatus.Empty
        },
        Source    = row.Source switch
        {
            "formula"  => CellSource.Formula,
            "imported" => CellSource.Imported,
            _          => CellSource.Manual
        },
        FormulaId = row.FormulaId,
    };

    private static string StatusToString(CellStatus s) => s switch
    {
        CellStatus.Ok    => "ok",
        CellStatus.Error => "error",
        _                => "empty"
    };

    private static string SourceToString(CellSource s) => s switch
    {
        CellSource.Formula   => "formula",
        CellSource.Imported  => "imported",
        _                    => "manual"
    };

    // ── DTO interno para Dapper ───────────────────────────────
    // Classe com constructor sem parâmetros + propriedades settable
    // — necessário para o Dapper materializar correctamente em .NET 10.

    private sealed class CellRow
    {
        public int      VersionId  { get; set; }
        public int      Year       { get; set; }
        public byte     Month      { get; set; }
        public int      VariableId { get; set; }
        public int?     LanguageId { get; set; }
        public int?     LobId      { get; set; }
        public decimal? Value      { get; set; }
        public string   Status     { get; set; } = "empty";
        public string   Source     { get; set; } = "manual";
        public int?     FormulaId  { get; set; }
    }
}
