using MotorCalculo.Engine.Exceptions;
using MotorCalculo.Engine.Models;
using MotorCalculo.Engine.Parsing;

namespace MotorCalculo.Engine.Sorting;

/// <summary>
/// Ordena as variáveis calculadas por ordem de dependência (Kahn's algorithm).
/// Garante que quando uma variável é avaliada, todos os seus inputs já foram calculados.
///
/// Usa a união de todas as fórmulas (main + alternatives) para construir o grafo —
/// ordenação conservadora que é válida para qualquer combinação de triggers activos.
/// </summary>
public static class TopologicalSort
{
    /// <summary>
    /// Devolve os códigos das variáveis na ordem em que devem ser avaliadas.
    /// Variáveis de input aparecem antes das calculadas.
    /// </summary>
    public static IReadOnlyList<string> Sort(IReadOnlyList<VariableDefinition> variables)
    {
        var allCodes = variables.Select(v => v.Code).ToHashSet();
        var deps     = BuildDependencies(variables, allCodes);
        return KahnSort(variables.Select(v => v.Code).ToList(), deps);
    }

    /// <summary>
    /// Extrai os códigos de variáveis referenciados num nó AST.
    /// </summary>
    public static IEnumerable<string> ExtractDependencies(AstNode node) => node switch
    {
        VariableNode v  => [v.Code],
        PrevNode     p  => [p.Code],
        SumLobsNode  sl => [sl.Code],
        SumLangsNode sg => [sg.Code],
        BinaryOpNode op => ExtractDependencies(op.Left).Concat(ExtractDependencies(op.Right)),
        _               => []
    };

    // ── Private ───────────────────────────────────────────────

    /// <summary>
    /// Constrói o grafo de dependências: code → set de códigos de que depende.
    /// Inclui todas as fórmulas de cada variável (main + alternatives + default).
    /// </summary>
    private static Dictionary<string, HashSet<string>> BuildDependencies(
        IReadOnlyList<VariableDefinition> variables,
        HashSet<string> allCodes)
    {
        var deps = variables.ToDictionary(v => v.Code, _ => new HashSet<string>());

        foreach (var variable in variables)
        {
            if (variable.IsInput || variable.Formulas.Count == 0) continue;

            foreach (var formula in variable.Formulas)
            {
                AstNode ast;
                try
                {
                    var tokens = Tokenizer.Tokenize(formula.Expression);
                    ast = new Parser(tokens).Parse();
                }
                catch
                {
                    continue; // fórmula inválida — ignora para efeitos de ordenação
                }

                foreach (var dep in ExtractDependencies(ast))
                {
                    if (allCodes.Contains(dep) && dep != variable.Code)
                        deps[variable.Code].Add(dep);
                }
            }
        }

        return deps;
    }

    /// <summary>Kahn's algorithm: ordenação topológica por grau de entrada.</summary>
    private static IReadOnlyList<string> KahnSort(
        List<string> nodes,
        Dictionary<string, HashSet<string>> deps)
    {
        // Grau de entrada: quantas variáveis esta depende
        var inDegree = nodes.ToDictionary(n => n, _ => 0);

        // Lista de adjacência inversa: dep → lista de variáveis que dependem de dep
        var adjacency = nodes.ToDictionary(n => n, _ => new List<string>());

        foreach (var (node, nodeDeps) in deps)
            foreach (var dep in nodeDeps)
            {
                if (!adjacency.ContainsKey(dep)) continue;
                adjacency[dep].Add(node);
                inDegree[node]++;
            }

        // Fila inicial: variáveis sem dependências (inputs primeiro)
        var queue  = new Queue<string>(nodes.Where(n => inDegree[n] == 0));
        var result = new List<string>(nodes.Count);

        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            result.Add(current);

            foreach (var dependent in adjacency[current])
            {
                if (--inDegree[dependent] == 0)
                    queue.Enqueue(dependent);
            }
        }

        if (result.Count != nodes.Count)
            throw new CircularDependencyException(
                "Dependência circular detectada no grafo de fórmulas. " +
                $"Variáveis não ordenadas: {string.Join(", ", nodes.Except(result))}");

        return result;
    }
}
