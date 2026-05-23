namespace MotorCalculo.Application.DTOs;

// ─────────────────────────────────────────────────────────────
//  Cell DTOs
// ─────────────────────────────────────────────────────────────

/// <summary>
/// Pedido de edição de uma célula.
/// Enviado pelo frontend quando o utilizador altera um valor
/// ou quando o sistema externo importa um valor.
/// </summary>
public sealed record EditCellRequest(
    int      VersionId,
    int      VariableId,
    int?     LanguageId,
    int?     LobId,
    int      Year,
    int      Month,
    decimal? Value,       // null = limpar o valor (volta a Empty)
    string   Source       // "manual" | "imported"
);

/// <summary>
/// Célula devolvida no delta — apenas as células que mudaram.
/// O frontend actualiza só estas, não toda a grelha.
/// </summary>
public sealed record CellDto(
    int      VariableId,
    int?     LanguageId,
    int?     LobId,
    int      Year,
    int      Month,
    decimal? Value,
    string   Status,      // "ok" | "error" | "empty"
    string   Source,      // "manual" | "formula" | "imported"
    int?     FormulaId    // qual fórmula alternativa está activa
);

/// <summary>Resposta ao EditCell — delta calculado pelo motor.</summary>
public sealed record EditCellResponse(
    IReadOnlyList<CellDto> Delta,
    int                    DeltaCount,
    Guid                   SessionId     // para correlação com o CalculationLog
);

/// <summary>Resposta ao carregar uma versão completa.</summary>
public sealed record LoadVersionResponse(
    int                    VersionId,
    IReadOnlyList<CellDto> Cells
);

// ─────────────────────────────────────────────────────────────
//  Version DTOs
// ─────────────────────────────────────────────────────────────

public sealed record CreateVersionRequest(
    int    ProjectId,
    string Code,
    string Name
);

public sealed record CloneVersionRequest(
    int    FromVersionId,
    string Code,
    string Name
);

public sealed record VersionResponse(
    int      VersionId,
    int      ProjectId,
    string   Code,
    string   Name,
    int?     ClonedFromId,
    byte     ColorIndex,
    DateTime CreatedAt
);

// ─────────────────────────────────────────────────────────────
//  Template DTOs
// ─────────────────────────────────────────────────────────────

public sealed record TemplateResponse(
    int    TemplateId,
    string Code,
    string Name
);

public sealed record VariableResponse(
    int     VariableId,
    string  Code,
    string  Name,
    string  ScopeCode,
    bool    IsInput,
    string? ExternalField,
    int     SortOrder,
    int?    GroupId,
    IReadOnlyList<FormulaResponse> Formulas
);

public sealed record FormulaResponse(
    int     FormulaId,
    string  FormulaType,
    string  Expression,
    int?    TriggerVariableId
);

// ─────────────────────────────────────────────────────────────
//  Project DTOs
// ─────────────────────────────────────────────────────────────

public sealed record ProjectResponse(
    int    ProjectId,
    int    TemplateId,
    string Code,
    string Name
);

public sealed record ProjectStructureResponse(
    int                          ProjectId,
    IReadOnlyList<LanguageResponse> Languages
);

public sealed record LanguageResponse(
    int                       LanguageId,
    string                    Code,
    string                    Name,
    IReadOnlyList<LobResponse> Lobs
);

public sealed record LobResponse(
    int    LobId,
    string Code,
    string Name
);
