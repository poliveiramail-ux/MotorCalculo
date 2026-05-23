namespace MotorCalculo.Engine.Models;

/// <summary>
/// Identifica uma célula de forma única.
/// Substitui a chave string "prj·ver·202601·v_rec·l_pt·b_ret" do protótipo JS.
/// </summary>
public readonly record struct CellKey(
    int    VersionId,
    int    Year,
    int    Month,
    int    VariableId,
    int?   LanguageId,   // null para scope='template'
    int?   LobId          // null para scope='template' e scope='language'
)
{
    /// <summary>Período como YYYYMM — equivalente ao period_yyyymm da BD.</summary>
    public int PeriodYyyymm => Year * 100 + Month;
}

/// <summary>Estado do valor de uma célula.</summary>
public enum CellStatus
{
    /// <summary>Valor válido — value está preenchido.</summary>
    Ok,

    /// <summary>
    /// Erro de cálculo (divisão por zero, referência inválida).
    /// Propaga pela cadeia com prioridade sobre Empty.
    /// </summary>
    Error,

    /// <summary>
    /// Célula por preencher — input a montante ainda não introduzido.
    /// Propaga mas cede a Error.
    /// </summary>
    Empty
}

/// <summary>Origem do valor de uma célula.</summary>
public enum CellSource
{
    /// <summary>Introduzido pelo utilizador na grelha.</summary>
    Manual,

    /// <summary>
    /// Calculado pelo motor. source='formula' na BD.
    /// O motor avalia a fórmula e escreve o resultado.
    /// </summary>
    Formula,

    /// <summary>
    /// Veio do sistema externo.
    /// O motor NÃO avalia a fórmula mesmo que a variável tenha expression.
    /// </summary>
    Imported
}

/// <summary>
/// Valor de uma célula em memória (working set do motor).
/// Imutável — o motor produz novas instâncias, nunca muta.
/// </summary>
public sealed record CellValue
{
    /// <summary>Null quando Status ≠ Ok.</summary>
    public decimal? Value     { get; init; }
    public CellStatus Status  { get; init; } = CellStatus.Empty;
    public CellSource Source  { get; init; } = CellSource.Manual;

    /// <summary>
    /// FK para VariableFormula — qual fórmula gerou este valor.
    /// Null quando Source ≠ Formula.
    /// Não substitui o active_trigger_id (estado de sessão): persiste apenas o
    /// resultado e qual fórmula o produziu, não a decisão que levou a ela.
    /// </summary>
    public int? FormulaId { get; init; }

    public static CellValue Empty(CellSource source = CellSource.Formula) =>
        new() { Status = CellStatus.Empty, Source = source };

    public static CellValue ForError(CellSource source = CellSource.Formula) =>
        new() { Status = CellStatus.Error, Source = source };

    public static CellValue ForValue(decimal value, int? formulaId = null) =>
        new() { Value = value, Status = CellStatus.Ok, Source = CellSource.Formula, FormulaId = formulaId };
}
