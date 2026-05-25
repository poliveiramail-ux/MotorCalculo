namespace MotorCalculo.Engine.Models;

/// <summary>
/// Definição de uma variável carregada do template.
/// Imutável — representa a configuração, não os valores.
/// </summary>
public sealed record VariableDefinition
{
    public int    VariableId    { get; init; }
    public string Code          { get; init; } = "";
    public string Name          { get; init; } = "";

    /// <summary>"lob" | "language" | "project"</summary>
    public string ScopeCode     { get; init; } = "";

    public bool   IsInput       { get; init; }

    /// <summary>
    /// Nome do campo no sistema externo.
    /// Null → variável não recebe dados importados.
    /// </summary>
    public string? ExternalField { get; init; }
    public int?    GroupId      { get; init; }
    public string? GroupName    { get; init; }
    public int     GroupOrder   { get; init; }
    public int     SortOrder    { get; init; }

    /// <summary>
    /// Fórmulas associadas. Vazio para inputs.
    /// Uma variável calculada tem exactamente uma 'main',
    /// ou zero/uma 'default' + uma ou mais 'alternative'.
    /// </summary>
    public IReadOnlyList<FormulaDefinition> Formulas { get; init; } = [];
}

/// <summary>
/// Definição de uma fórmula — linha em VariableFormula na BD.
/// </summary>
public sealed record FormulaDefinition
{
    public int    FormulaId         { get; init; }

    /// <summary>"main" | "default" | "alternative"</summary>
    public string FormulaType       { get; init; } = "";

    /// <summary>
    /// Expressão na sintaxe do motor.
    /// Suporta referências absolutas: v_rec[PT][ret]
    /// </summary>
    public string Expression        { get; init; } = "";

    /// <summary>
    /// Variável cuya edição activa esta fórmula.
    /// Null para 'main' e 'default'.
    /// </summary>
    public int?   TriggerVariableId { get; init; }

    public int    SortOrder         { get; init; }
}
