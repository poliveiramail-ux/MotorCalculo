using MotorCalculo.Engine.Models;

namespace MotorCalculo.Engine.Evaluation;

/// <summary>
/// Contexto passado ao Evaluator para avaliar um nó AST.
/// Contém a posição corrente na grelha e o estado completo das células.
/// </summary>
public sealed record EvaluationContext(
    /// <summary>Versão em avaliação.</summary>
    int VersionId,

    /// <summary>Ano do período em avaliação.</summary>
    int Year,

    /// <summary>Mês do período em avaliação (1-12).</summary>
    int Month,

    /// <summary>Língua do contexto corrente. Null para scope='template'.</summary>
    int? LanguageId,

    /// <summary>LOB do contexto corrente. Null para scope≠'lob'.</summary>
    int? LobId,

    /// <summary>Estrutura do projecto — línguas e LOBs com os seus códigos.</summary>
    ProjectStructure Project,

    /// <summary>Mapa code → variableId para resolver referências nas fórmulas.</summary>
    IReadOnlyDictionary<string, int> VariableCodeToId,

    /// <summary>Mapa variableId → scopeCode ("template"|"language"|"lob") para resolver cross-scope.</summary>
    IReadOnlyDictionary<int, string> VariableIdToScope,

    /// <summary>Estado completo das células no momento da avaliação (actualizado durante a sessão).</summary>
    IReadOnlyDictionary<CellKey, CellValue> Cells,

    /// <summary>
    /// Snapshot das células no início da sessão (antes de qualquer cálculo desta iteração).
    /// Usado por WEIGHT() para evitar circularidade — lê sempre os valores originais.
    /// </summary>
    IReadOnlyDictionary<CellKey, CellValue> Snapshot
);
