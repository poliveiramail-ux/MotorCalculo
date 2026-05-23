using MotorCalculo.Engine.Evaluation;
using MotorCalculo.Engine.Models;
using MotorCalculo.Engine.Parsing;
using MotorCalculo.Engine.Sorting;

namespace MotorCalculo.Engine.Session;

/// <summary>
/// Orquestra um recálculo completo a partir de uma edição.
///
/// Fluxo:
///   1. Determina quais variáveis calculadas são afectadas (BFS no grafo inverso)
///   2. Selecciona a fórmula correcta para cada variável:
///      - Se o variableId editado é trigger de uma fórmula alternativa → usa essa alternativa
///      - Caso contrário → mantém a fórmula que estava activa (formula_id da célula existente)
///      - Fallback → 'main' ou 'default'
///   3. Avalia em ordem topológica, para cada período em ordem cronológica
///      (crucial para PREV — o período t lê o t-1 já calculado)
///   4. Devolve apenas as células que mudaram (delta)
///
/// Imutável em relação ao estado externo: trabalha numa cópia do dicionário de células.
/// </summary>
public sealed class CalculationSession
{
    private readonly IReadOnlyList<VariableDefinition>   _variables;
    private readonly IReadOnlyList<int>                  _periods;   // YYYYMM, ordem crescente
    private readonly ProjectStructure                    _project;

    // Pré-computados no constructor (custo único por sessão)
    private readonly IReadOnlyList<string>               _sortedCodes;   // ordem topológica
    private readonly Dictionary<string, VariableDefinition> _byCode;
    private readonly Dictionary<int, VariableDefinition>    _byId;
    private readonly Dictionary<string, int>                _codeToId;     // para o Evaluator
    private readonly Dictionary<int, string>                _scopeById;    // variableId → scopeCode
    private readonly Dictionary<string, HashSet<string>>    _reverseDeps;  // code → dependentes
    // formulaId → conjunto de códigos de variáveis que a fórmula referencia (main + alternatives)
    private readonly Dictionary<int, HashSet<string>>       _formulaDeps;

    public CalculationSession(
        IReadOnlyList<VariableDefinition> variables,
        IReadOnlyList<int> periods,
        ProjectStructure project)
    {
        _variables    = variables;
        _periods      = [.. periods.OrderBy(p => p)];   // garante ordem cronológica
        _project      = project;
        _sortedCodes  = TopologicalSort.Sort(variables);
        _byCode       = variables.ToDictionary(v => v.Code);
        _byId         = variables.ToDictionary(v => v.VariableId);
        _codeToId     = variables.ToDictionary(v => v.Code, v => v.VariableId);
        _scopeById    = variables.ToDictionary(v => v.VariableId, v => v.ScopeCode);
        _reverseDeps  = BuildReverseDependencies();
        _formulaDeps  = BuildFormulaDependencies(variables);
    }

    /// <summary>
    /// Executa o recálculo a partir da célula editada.
    /// Não modifica <paramref name="cells"/> — trabalha numa cópia.
    /// </summary>
    /// <param name="editedKey">Célula que foi editada pelo utilizador ou importada.</param>
    /// <param name="cells">Estado completo das células antes da edição.</param>
    /// <returns>Lista de células que mudaram, em ordem de cálculo.</returns>
    public IReadOnlyList<CalculatedCell> Run(
        CellKey editedKey,
        Dictionary<CellKey, CellValue> cells)
    {
        if (!_byId.TryGetValue(editedKey.VariableId, out var editedVar))
            return [];

        // Snapshot imutável das células no início da sessão.
        // Usado por WEIGHT() para evitar circularidade.
        IReadOnlyDictionary<CellKey, CellValue> snapshot = cells;

        // Cópia de trabalho — o motor não muta o input
        var working = new Dictionary<CellKey, CellValue>(cells);

        // Variáveis calculadas afectadas (dependentes da variável editada), em ordem topológica
        var affected = GetAffectedVariableCodes(editedVar.Code);
        var toRecalc = _sortedCodes
            .Where(c => affected.Contains(c) && _byCode.TryGetValue(c, out var v) && !v.IsInput)
            .Select(c => _byCode[c])
            .ToList();

        var delta        = new List<CalculatedCell>();
        var step         = 0;
        var editedPeriod = editedKey.Year * 100 + editedKey.Month;

        // changedVarIds[período] = IDs das variáveis que efectivamente mudaram nesse período.
        // Começa com a variável editada no período editado.
        // Usado para determinar se existe propagação via PREV para o período seguinte.
        var changedVarIds = new Dictionary<int, HashSet<int>>
        {
            [editedPeriod] = [editedKey.VariableId]
        };

        // affectedCodes: variável editada + todas as variáveis calculadas afectadas.
        // Pré-computado uma vez — é o mesmo para todos os períodos e contextos.
        var affectedCodes = new HashSet<string>(affected) { editedVar.Code };

        foreach (var period in _periods)
        {
            var year  = period / 100;
            var month = period % 100;

            if (period != editedPeriod)
            {
                // Para períodos posteriores: só processa se alguma variável que mudou
                // no período anterior é referenciada via PREV numa fórmula de toRecalc.
                var prevPeriod = PreviousPeriod(period);
                if (!changedVarIds.TryGetValue(prevPeriod, out var prevChanged) ||
                    !HasAnyPrevDependencyOnChanged(toRecalc, prevChanged))
                    continue;   // sem propagação temporal → para aqui
            }

            // Garante que o período tem uma entrada no dicionário
            if (!changedVarIds.ContainsKey(period))
                changedVarIds[period] = [];

            foreach (var variable in toRecalc)
            {

                foreach (var (langId, lobId) in GetContexts(variable))
                {
                    var key = new CellKey(editedKey.VersionId, year, month,
                                          variable.VariableId, langId, lobId);

                    // Célula importada → motor não interfere
                    if (working.TryGetValue(key, out var existing) &&
                        existing.Source == CellSource.Imported)
                        continue;

                    var formula = SelectFormula(variable, key, working, affectedCodes);
                    if (formula is null) continue;

                    // Parse + evaluate
                    AstNode ast;
                    try   { ast = new Parser(Tokenizer.Tokenize(formula.Expression)).Parse(); }
                    catch { continue; }

                    var ctx = new EvaluationContext(
                        editedKey.VersionId, year, month,
                        langId, lobId, _project, _codeToId, _scopeById, working, snapshot);

                    var (value, status) = Evaluator.Evaluate(ast, ctx);

                    var newCell = new CellValue
                    {
                        Value     = status == CellStatus.Ok ? value : null,
                        Status    = status,
                        Source    = CellSource.Formula,
                        // FormulaId só é relevante quando há um valor válido.
                        // Células Empty/Error com FormulaId=null são idênticas
                        // a células por preencher — evita falsos positivos no delta.
                        FormulaId = status == CellStatus.Ok ? formula.FormulaId : null,
                    };

                    var before = working.GetValueOrDefault(key, CellValue.Empty());

                    // Só regista no delta se houve alteração
                    if (!CellsEqual(before, newCell))
                    {
                        working[key] = newCell;
                        delta.Add(new CalculatedCell(key, before, newCell, ++step, formula.Expression));
                        // Marca esta variável como alterada neste período
                        // para desencadear propagação PREV no período seguinte
                        changedVarIds[period].Add(variable.VariableId);
                    }
                }
            }
        }

        return delta;
    }

    // ── Formula selection ─────────────────────────────────────

    /// <summary>
    /// Selecciona a fórmula a usar para esta célula:
    /// 1. Se o variável editado é trigger de uma alternativa → usa essa alternativa
    /// 2. Caso contrário → mantém a fórmula anteriormente activa (via formula_id)
    /// 3. Fallback → 'main' ou 'default'
    /// </summary>
    /// <summary>
    /// Selecciona a fórmula a usar para calcular <paramref name="variable"/> nesta sessão.
    ///
    /// Para variáveis com alternativas, a selecção é baseada inteiramente no estado
    /// actual das dependências — sem memória de sessões anteriores:
    ///
    ///   1. Alguma alternativa tem o seu trigger na cadeia de variáveis afectadas
    ///      pela edição actual (<paramref name="affectedCodes"/>)?
    ///      → usa essa alternativa (a edição actual "activou" esse trigger)
    ///
    ///   2. Exactamente uma alternativa tem trigger com valor não-vazio nas células actuais?
    ///      → usa essa alternativa (só um trigger está presente)
    ///
    ///   3. Nenhuma alternativa elegível → variável não pode ser calculada → null
    ///      (o user ainda não forneceu nenhum trigger)
    ///
    /// Não existe fallback "default" — a fórmula é sempre determinada pelas dependências.
    /// </summary>
    private FormulaDefinition? SelectFormula(
        VariableDefinition variable,
        CellKey key,
        Dictionary<CellKey, CellValue> working,
        HashSet<string> affectedCodes)
    {
        var formulas = variable.Formulas;
        if (formulas.Count == 0) return null;

        var alternatives = formulas.Where(f => f.FormulaType == "alternative").ToList();

        // Variável sem alternativas: usa directamente a fórmula main
        if (alternatives.Count == 0)
            return formulas.FirstOrDefault(f => f.FormulaType == "main");

        // ── Passo 1: alternativa cujo trigger está na cadeia de dependências actual ──
        // _formulaDeps[formulaId] contém as variáveis referenciadas por essa fórmula.
        // Se alguma delas foi afectada pela edição actual, esta é a alternativa correcta.
        var altByDep = alternatives.FirstOrDefault(alt =>
            _formulaDeps.TryGetValue(alt.FormulaId, out var deps) &&
            deps.Any(code => affectedCodes.Contains(code)));

        if (altByDep is not null) return altByDep;

        // ── Passo 2: exactamente um trigger tem valor actual (sem ambiguidade) ──
        var altsWithValue = alternatives.Where(alt =>
        {
            if (alt.TriggerVariableId is null) return false;

            // Lookup scope-aware do trigger
            var trigVarId  = alt.TriggerVariableId.Value;
            var trigLangId = key.LanguageId;
            var trigLobId  = key.LobId;

            if (_scopeById.TryGetValue(trigVarId, out var trigScope))
            {
                if (trigScope == "project") { trigLangId = null; trigLobId = null; }
                else if (trigScope == "language")  { trigLobId = null; }
            }

            var trigKey = new CellKey(key.VersionId, key.Year, key.Month,
                                       trigVarId, trigLangId, trigLobId);
            return working.TryGetValue(trigKey, out var cell) && cell.Status == CellStatus.Ok;
        }).ToList();

        if (altsWithValue.Count == 1) return altsWithValue[0];

        // ── Passo 3: ambíguo ou sem trigger → não pode calcular ──
        return null;
    }

    // ── Dependency graph ──────────────────────────────────────

    /// <summary>BFS: encontra todos os códigos que dependem (directa ou transitivamente) de editedCode.</summary>
    private HashSet<string> GetAffectedVariableCodes(string editedCode)
    {
        var affected = new HashSet<string>();
        var queue    = new Queue<string>();

        if (_reverseDeps.TryGetValue(editedCode, out var direct))
            foreach (var d in direct) queue.Enqueue(d);

        while (queue.Count > 0)
        {
            var code = queue.Dequeue();
            if (!affected.Add(code)) continue;
            if (_reverseDeps.TryGetValue(code, out var more))
                foreach (var d in more) queue.Enqueue(d);
        }

        return affected;
    }

    /// <summary>
    /// Constrói o grafo de dependências inverso: code → set de variáveis que dependem deste code.
    /// Usa a união de todas as fórmulas (conservador — válido para qualquer trigger activo).
    /// </summary>
    private Dictionary<string, HashSet<string>> BuildReverseDependencies()
    {
        var reverse = _variables.ToDictionary(v => v.Code, _ => new HashSet<string>());

        foreach (var variable in _variables)
        {
            if (variable.IsInput || variable.Formulas.Count == 0) continue;

            foreach (var formula in variable.Formulas)
            {
                AstNode ast;
                try   { ast = new Parser(Tokenizer.Tokenize(formula.Expression)).Parse(); }
                catch { continue; }

                foreach (var dep in TopologicalSort.ExtractDependencies(ast))
                {
                    if (reverse.ContainsKey(dep))
                        reverse[dep].Add(variable.Code);
                }
            }
        }

        return reverse;
    }

    // ── Context enumeration ───────────────────────────────────

    /// <summary>Enumera todos os pares (langId, lobId) para o scope da variável.</summary>
    private IEnumerable<(int? LangId, int? LobId)> GetContexts(VariableDefinition variable) =>
        variable.ScopeCode switch
        {
            "project" => [(null, null)],
            "language" => _project.Languages.Select(l => ((int?)l.LanguageId, (int?)null)),
            "lob"      => _project.Languages
                              .SelectMany(l => l.Lobs
                                  .Select(b => ((int?)l.LanguageId, (int?)b.LobId))),
            _          => []
        };

    // ── Helpers ───────────────────────────────────────────────

    /// <summary>
    /// Constrói o mapa formulaId → conjunto de códigos de variáveis referenciadas.
    /// Percorre todas as fórmulas de todas as variáveis uma única vez no arranque.
    /// Usado em SelectFormula para determinar qual alternativa é activada pela edição actual.
    /// </summary>
    private static Dictionary<int, HashSet<string>> BuildFormulaDependencies(
        IReadOnlyList<VariableDefinition> variables)
    {
        var result = new Dictionary<int, HashSet<string>>();

        foreach (var variable in variables)
        {
            foreach (var formula in variable.Formulas)
            {
                var deps = new HashSet<string>();
                try
                {
                    var ast = new Parser(Tokenizer.Tokenize(formula.Expression)).Parse();
                    foreach (var code in TopologicalSort.ExtractDependencies(ast))
                        deps.Add(code);
                }
                catch { /* fórmula inválida — ignora */ }

                result[formula.FormulaId] = deps;
            }
        }

        return result;
    }

    private static bool CellsEqual(CellValue a, CellValue b) =>
        a.Status == b.Status && a.Value == b.Value && a.FormulaId == b.FormulaId;

    /// <summary>
    /// Devolve o período anterior (YYYYMM).
    /// Ex: 202601 → 202512, 202603 → 202602.
    /// </summary>
    private static int PreviousPeriod(int period)
    {
        var year  = period / 100;
        var month = period % 100;
        return month == 1 ? (year - 1) * 100 + 12 : year * 100 + (month - 1);
    }

    /// <summary>
    /// Verifica se alguma variável em <paramref name="variables"/> tem uma fórmula
    /// com PREV(X) onde X é uma variável cujo ID está em <paramref name="changedIds"/>.
    /// Usado para determinar se a alteração de um período se propaga para o seguinte.
    /// </summary>
    private bool HasAnyPrevDependencyOnChanged(
        IEnumerable<VariableDefinition> variables,
        HashSet<int> changedIds)
    {
        foreach (var variable in variables)
        {
            foreach (var formula in variable.Formulas)
            {
                try
                {
                    var ast = new Parser(Tokenizer.Tokenize(formula.Expression)).Parse();
                    foreach (var code in ExtractPrevCodes(ast))
                    {
                        if (_codeToId.TryGetValue(code, out var id) && changedIds.Contains(id))
                            return true;
                    }
                }
                catch { /* fórmula inválida — ignora */ }
            }
        }
        return false;
    }

    /// <summary>
    /// Extrai os códigos das variáveis referenciadas em nós PREV do AST.
    /// </summary>
    private static IEnumerable<string> ExtractPrevCodes(AstNode node) => node switch
    {
        PrevNode     prev => [prev.Code],
        BinaryOpNode op   => [..ExtractPrevCodes(op.Left), ..ExtractPrevCodes(op.Right)],
        _                 => []
    };
}
