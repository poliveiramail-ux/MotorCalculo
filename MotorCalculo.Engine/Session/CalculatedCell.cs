using MotorCalculo.Engine.Models;

namespace MotorCalculo.Engine.Session;

/// <summary>
/// Resultado de um passo de cálculo — uma célula que foi alterada.
/// Alimenta o delta devolvido ao CellService e (quando activo) o CalculationLog.
/// </summary>
public sealed record CalculatedCell(
    /// <summary>Identificação da célula.</summary>
    CellKey Key,

    /// <summary>Estado antes do recálculo.</summary>
    CellValue Before,

    /// <summary>Estado depois do recálculo.</summary>
    CellValue After,

    /// <summary>Posição na sequência topológica (para CalculationLog.step).</summary>
    int Step,

    /// <summary>Expressão que foi avaliada (cópia para auditoria).</summary>
    string? ExpressionUsed
)
{
    /// <summary>Diferença value_after − value_before. Null se algum dos dois não for Ok.</summary>
    public decimal? Delta => After.Status == CellStatus.Ok && Before.Status == CellStatus.Ok
        ? After.Value - Before.Value
        : null;
}
