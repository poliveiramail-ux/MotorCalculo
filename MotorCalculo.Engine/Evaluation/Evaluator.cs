using MotorCalculo.Engine.Models;
using MotorCalculo.Engine.Parsing;

namespace MotorCalculo.Engine.Evaluation;

/// <summary>
/// Avalia um nó AST dado um contexto de célula.
/// Todas as funções são puras — sem efeitos secundários.
///
/// Regras de propagação de status:
///   Error > Empty > Ok
///   Divisão por zero → Error
///   Variável desconhecida → Error
///   Referência para período inexistente (PREV) → 0 / Ok
///   Referência para célula inexistente (input por preencher) → Empty
/// </summary>
public static class Evaluator
{
    public static (decimal? Value, CellStatus Status) Evaluate(
        AstNode node, EvaluationContext ctx) => node switch
    {
        LiteralNode  lit => (lit.Value, CellStatus.Ok),
        VariableNode  v  => EvalRef(v.Code, v.LangCode, v.LobCode, ctx, ctx.Year, ctx.Month, isPrev: false),
        PrevNode      p  => EvalRef(p.Code, p.LangCode, p.LobCode, ctx, PrevYear(ctx.Year, ctx.Month), PrevMonth(ctx.Month), isPrev: true),
        CountLobsNode _  => EvalCountLobs(ctx),
        CountLangsNode _ => ((decimal)ctx.Project.Languages.Count, CellStatus.Ok),
        WeightNode     w  => EvalWeight(w.Code, w.LangCode, ctx),
        WeightLangNode wl => EvalWeightLang(wl.Code, ctx),
        SumLobsNode  sl  => EvalSumLobs(sl, ctx),
        SumLangsNode sg  => EvalSumLangs(sg, ctx),
        BinaryOpNode op  => EvalBinaryOp(op, ctx),
        _                => (null, CellStatus.Error)
    };

    // ── Variable reference ────────────────────────────────────

    private static (decimal? Value, CellStatus Status) EvalRef(
        string code, string? langCode, string? lobCode,
        EvaluationContext ctx,
        int year, int month,
        bool isPrev)
    {
        if (!ctx.VariableCodeToId.TryGetValue(code, out var varId))
            return (null, CellStatus.Error);   // variável não existe no template

        var resolvedLangId = ResolveLangId(langCode, ctx);
        var resolvedLobId  = ResolveLobId(lobCode, resolvedLangId, ctx);

        // Resolve o âmbito declarado da variável referenciada para construir
        // a chave correcta — cross-scope reference sem qualificadores explícitos.
        // Ex: fórmula LOB que usa v_inflacao (template) ou v_tx_desc (language).
        var effectiveLangId = resolvedLangId;
        var effectiveLobId  = resolvedLobId;

        if (ctx.VariableIdToScope.TryGetValue(varId, out var varScope))
        {
            if (varScope == "template")
            {
                // Variável de projecto: ignora lang e lob do contexto
                effectiveLangId = null;
                effectiveLobId  = null;
            }
            else if (varScope == "language")
            {
                // Variável de língua: ignora lob do contexto mas mantém lang
                effectiveLobId = null;
            }
            // "lob": usa lang e lob do contexto — comportamento padrão
        }

        var key = new CellKey(ctx.VersionId, year, month, varId, effectiveLangId, effectiveLobId);

        if (!ctx.Cells.TryGetValue(key, out var cell))
            return isPrev ? (0m, CellStatus.Ok) : (null, CellStatus.Empty);

        return cell.Status switch
        {
            CellStatus.Ok    => (cell.Value, CellStatus.Ok),
            CellStatus.Error => (null, CellStatus.Error),
            CellStatus.Empty => (null, CellStatus.Empty),
            _                => (null, CellStatus.Error)
        };
    }

    // ── SUM_LOBS ──────────────────────────────────────────────

    private static (decimal? Value, CellStatus Status) EvalSumLobs(
        SumLobsNode node, EvaluationContext ctx)
    {
        if (!ctx.VariableCodeToId.TryGetValue(node.Code, out var varId))
            return (null, CellStatus.Error);

        var resolvedLangId = ResolveLangId(node.LangCode, ctx);
        var lang = ctx.Project.Languages.FirstOrDefault(l => l.LanguageId == resolvedLangId);
        if (lang is null) return (null, CellStatus.Error);

        // Se LobCode está fixado, SUM_LOBS degenera numa referência directa
        var lobs = node.LobCode is not null
            ? lang.Lobs.Where(b => b.Code == node.LobCode).ToList()
            : [.. lang.Lobs];

        var sum = 0m;
        foreach (var lob in lobs)
        {
            var key = new CellKey(ctx.VersionId, ctx.Year, ctx.Month, varId, resolvedLangId, lob.LobId);
            if (!ctx.Cells.TryGetValue(key, out var cell)) continue;   // trata como 0
            if (cell.Status == CellStatus.Error) return (null, CellStatus.Error);
            if (cell.Status == CellStatus.Empty) return (null, CellStatus.Empty);
            sum += cell.Value ?? 0m;
        }
        return (sum, CellStatus.Ok);
    }

    // ── SUM_LANGS ─────────────────────────────────────────────

    private static (decimal? Value, CellStatus Status) EvalSumLangs(
        SumLangsNode node, EvaluationContext ctx)
    {
        if (!ctx.VariableCodeToId.TryGetValue(node.Code, out var varId))
            return (null, CellStatus.Error);

        // Se LangCode está fixado, SUM_LANGS degenera numa referência directa
        var langs = node.LangCode is not null
            ? ctx.Project.Languages.Where(l => l.Code == node.LangCode).ToList()
            : [.. ctx.Project.Languages];

        var sum = 0m;
        foreach (var lang in langs)
        {
            var key = new CellKey(ctx.VersionId, ctx.Year, ctx.Month, varId, lang.LanguageId, null);
            if (!ctx.Cells.TryGetValue(key, out var cell)) continue;
            if (cell.Status == CellStatus.Error) return (null, CellStatus.Error);
            if (cell.Status == CellStatus.Empty) return (null, CellStatus.Empty);
            sum += cell.Value ?? 0m;
        }
        return (sum, CellStatus.Ok);
    }

    // ── Binary operation ──────────────────────────────────────

    private static (decimal? Value, CellStatus Status) EvalBinaryOp(
        BinaryOpNode node, EvaluationContext ctx)
    {
        var (lVal, lStatus) = Evaluate(node.Left,  ctx);
        var (rVal, rStatus) = Evaluate(node.Right, ctx);

        // Error propaga com prioridade sobre Empty
        if (lStatus == CellStatus.Error || rStatus == CellStatus.Error)
            return (null, CellStatus.Error);
        if (lStatus == CellStatus.Empty || rStatus == CellStatus.Empty)
            return (null, CellStatus.Empty);

        return node.Op switch
        {
            '+' => (lVal!.Value + rVal!.Value, CellStatus.Ok),
            '-' => (lVal!.Value - rVal!.Value, CellStatus.Ok),
            '*' => (lVal!.Value * rVal!.Value, CellStatus.Ok),
            '/' => rVal!.Value == 0m
                       ? (null, CellStatus.Error)   // divisão por zero → Error
                       : (lVal!.Value / rVal.Value, CellStatus.Ok),
            _   => (null, CellStatus.Error)
        };
    }

    // ── Context resolution ────────────────────────────────────

    /// <summary>
    /// Resolve um código de língua para language_id.
    /// null → herda o contexto corrente (ctx.LanguageId).
    /// </summary>
    private static int? ResolveLangId(string? langCode, EvaluationContext ctx)
    {
        if (langCode is null) return ctx.LanguageId;
        return ctx.Project.Languages
                   .FirstOrDefault(l => l.Code == langCode)?.LanguageId;
    }

    /// <summary>
    /// Resolve um código de LOB para lob_id dentro da língua resolvida.
    /// null → herda o contexto corrente (ctx.LobId).
    /// </summary>
    private static int? ResolveLobId(string? lobCode, int? resolvedLangId, EvaluationContext ctx)
    {
        if (lobCode is null) return ctx.LobId;
        var lang = ctx.Project.Languages.FirstOrDefault(l => l.LanguageId == resolvedLangId);
        return lang?.Lobs.FirstOrDefault(b => b.Code == lobCode)?.LobId;
    }

    // ── Period navigation ─────────────────────────────────────

    private static int PrevMonth(int month) => month == 1 ? 12 : month - 1;
    private static int PrevYear(int year, int month) => month == 1 ? year - 1 : year;

    // ── COUNT_LOBS() ──────────────────────────────────────────
    private static (decimal? Value, CellStatus Status) EvalCountLobs(EvaluationContext ctx)
    {
        var lang = ctx.Project.Languages.FirstOrDefault(l => l.LanguageId == ctx.LanguageId);
        if (lang is null) return (null, CellStatus.Error);
        return ((decimal)lang.Lobs.Count, CellStatus.Ok);
    }

    // ── WEIGHT(v_xxx) / WEIGHT(v_xxx)[*] ─────────────────────
    // Peso relativo deste LOB face ao denominador.
    // LangCode = null → denominador = todos os LOBs de todas as línguas
    // LangCode = "*"  → denominador = LOBs da língua actual
    // Lê do Snapshot para evitar circularidade.
    private static (decimal? Value, CellStatus Status) EvalWeight(
        string code, string? langCode, EvaluationContext ctx)
    {
        if (!ctx.VariableCodeToId.TryGetValue(code, out var varId))
            return (null, CellStatus.Error);

        var currentKey = new CellKey(ctx.VersionId, ctx.Year, ctx.Month,
                                      varId, ctx.LanguageId, ctx.LobId);
        if (!ctx.Snapshot.TryGetValue(currentKey, out var currentCell) ||
            currentCell.Status != CellStatus.Ok || currentCell.Value is null)
            return (null, CellStatus.Empty);

        var numerator   = currentCell.Value.Value;
        decimal denominator = 0m;

        if (langCode is null)
        {
            // WEIGHT(v) — todos os LOBs de todas as línguas
            foreach (var lang in ctx.Project.Languages)
                foreach (var lob in lang.Lobs)
                {
                    var k = new CellKey(ctx.VersionId, ctx.Year, ctx.Month,
                                        varId, lang.LanguageId, lob.LobId);
                    if (ctx.Snapshot.TryGetValue(k, out var c) &&
                        c.Status == CellStatus.Ok && c.Value.HasValue)
                        denominator += c.Value.Value;
                }
        }
        else // "*" — LOBs da língua actual
        {
            var curLang = ctx.Project.Languages
                .FirstOrDefault(l => l.LanguageId == ctx.LanguageId);
            if (curLang is not null)
                foreach (var lob in curLang.Lobs)
                {
                    var k = new CellKey(ctx.VersionId, ctx.Year, ctx.Month,
                                        varId, ctx.LanguageId, lob.LobId);
                    if (ctx.Snapshot.TryGetValue(k, out var c) &&
                        c.Status == CellStatus.Ok && c.Value.HasValue)
                        denominator += c.Value.Value;
                }
        }

        if (denominator == 0m) return (null, CellStatus.Error);
        return (numerator / denominator, CellStatus.Ok);
    }

    // ── WEIGHT_LANG(v_xxx) ────────────────────────────────────
    // Peso relativo da língua actual face a todas as línguas.
    // Numerador:   v_xxx[língua actual, lob=null]
    // Denominador: Σ v_xxx[todas as línguas, lob=null]
    // Lê do Snapshot para evitar circularidade.
    private static (decimal? Value, CellStatus Status) EvalWeightLang(
        string code, EvaluationContext ctx)
    {
        if (!ctx.VariableCodeToId.TryGetValue(code, out var varId))
            return (null, CellStatus.Error);

        var currentKey = new CellKey(ctx.VersionId, ctx.Year, ctx.Month,
                                      varId, ctx.LanguageId, null);
        if (!ctx.Snapshot.TryGetValue(currentKey, out var currentCell) ||
            currentCell.Status != CellStatus.Ok || currentCell.Value is null)
            return (null, CellStatus.Empty);

        var numerator   = currentCell.Value.Value;
        decimal denominator = 0m;

        foreach (var lang in ctx.Project.Languages)
        {
            var k = new CellKey(ctx.VersionId, ctx.Year, ctx.Month,
                                 varId, lang.LanguageId, null);
            if (ctx.Snapshot.TryGetValue(k, out var c) &&
                c.Status == CellStatus.Ok && c.Value.HasValue)
                denominator += c.Value.Value;
        }

        if (denominator == 0m) return (null, CellStatus.Error);
        return (numerator / denominator, CellStatus.Ok);
    }
}
