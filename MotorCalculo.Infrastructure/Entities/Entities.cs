namespace MotorCalculo.Infrastructure.Entities;

// ─────────────────────────────────────────────────────────────
//  Entidades EF Core — POCOs que espelham exactamente as tabelas
//  da BD. O mapeamento (nomes de colunas, constraints, índices)
//  é feito via Fluent API no DbContext.
//  Não expõem lógica de negócio — essa vive no Engine.
// ─────────────────────────────────────────────────────────────

public class EngineConfigEntity
{
    public string Key         { get; set; } = "";
    public string Value       { get; set; } = "";
    public string? Description{ get; set; }
}

public class TemplateEntity
{
    public int     TemplateId   { get; set; }
    public string  Code         { get; set; } = "";
    public string  Name         { get; set; } = "";
    public string? Description  { get; set; }
    public DateTime CreatedAt   { get; set; }
    public DateTime UpdatedAt   { get; set; }

    // Navegação
    public ICollection<VariableGroupEntity> Groups    { get; set; } = [];
    public ICollection<VariableEntity>      Variables { get; set; } = [];
}

public class VariableGroupEntity
{
    public int    GroupId    { get; set; }
    public int    TemplateId { get; set; }
    public string Code       { get; set; } = "";
    public string Name       { get; set; } = "";
    public int    SortOrder  { get; set; }

    public TemplateEntity?            Template  { get; set; }
    public ICollection<VariableEntity> Variables { get; set; } = [];
}

public class VariableEntity
{
    public int     VariableId    { get; set; }
    public int     TemplateId    { get; set; }
    public int?    GroupId       { get; set; }
    public string  Code          { get; set; } = "";
    public string  Name          { get; set; } = "";

    /// <summary>"lob" | "language" | "project"</summary>
    public string  ScopeCode     { get; set; } = "";
    public bool    IsInput        { get; set; }
    public string? ExternalField  { get; set; }
    public int     SortOrder      { get; set; }
    public DateTime CreatedAt     { get; set; }
    public DateTime UpdatedAt     { get; set; }

    public TemplateEntity?              Template { get; set; }
    public VariableGroupEntity?         Group    { get; set; }
    public ICollection<FormulaEntity>   Formulas { get; set; } = [];
}

public class FormulaEntity
{
    public int    FormulaId         { get; set; }
    public int    VariableId        { get; set; }

    /// <summary>"main" | "default" | "alternative"</summary>
    public string FormulaType       { get; set; } = "";
    public string Expression        { get; set; } = "";
    public int?   TriggerVariableId { get; set; }
    public int    SortOrder         { get; set; }

    public VariableEntity?  Variable        { get; set; }
    public VariableEntity?  TriggerVariable { get; set; }
}

public class ProjectEntity
{
    public int    ProjectId  { get; set; }
    public int    TemplateId { get; set; }
    public string Code       { get; set; } = "";
    public string Name       { get; set; } = "";
    public DateTime CreatedAt{ get; set; }

    public TemplateEntity?             Template  { get; set; }
    public ICollection<LanguageEntity> Languages { get; set; } = [];
    public ICollection<VersionEntity>  Versions  { get; set; } = [];
}

public class LanguageEntity
{
    public int    LanguageId { get; set; }
    public int    ProjectId  { get; set; }
    public string Code       { get; set; } = "";
    public string Name       { get; set; } = "";
    public int    SortOrder  { get; set; }

    public ProjectEntity?        Project { get; set; }
    public ICollection<LobEntity> Lobs   { get; set; } = [];
}

public class LobEntity
{
    public int    LobId      { get; set; }
    public int    LanguageId { get; set; }
    public string Code       { get; set; } = "";
    public string Name       { get; set; } = "";
    public int    SortOrder  { get; set; }

    public LanguageEntity? Language { get; set; }
}

public class VersionEntity
{
    public int     VersionId     { get; set; }
    public int     ProjectId     { get; set; }
    public string  Code          { get; set; } = "";
    public string  Name          { get; set; } = "";
    public int?    ClonedFromId  { get; set; }
    public byte    ColorIndex    { get; set; }
    public DateTime CreatedAt    { get; set; }

    public ProjectEntity?  Project     { get; set; }
    public VersionEntity?  ClonedFrom  { get; set; }
}

/// <summary>
/// Entidade de CellValue — apenas usada pelo DbContext para
/// modelação do schema. As queries efectivas são feitas via Dapper
/// para máxima performance no carregamento bulk.
/// </summary>
public class CellValueEntity
{
    public long    CellValueId { get; set; }
    public int     VersionId   { get; set; }
    public short   Year        { get; set; }
    public byte    Month       { get; set; }
    public int     VariableId  { get; set; }
    public int?    LanguageId  { get; set; }
    public int?    LobId       { get; set; }
    public decimal? Value      { get; set; }

    /// <summary>"ok" | "error" | "empty"</summary>
    public string  Status      { get; set; } = "empty";

    /// <summary>"manual" | "formula" | "imported"</summary>
    public string  Source      { get; set; } = "manual";

    public int?    FormulaId   { get; set; }
    public DateTime? ImportedAt{ get; set; }
    public DateTime? ComputedAt{ get; set; }
    // period_yyyymm é coluna computada — não é mapeada para escrita
}

public class CalculationLogEntity
{
    public long     LogId              { get; set; }
    public Guid     SessionId          { get; set; }
    public DateTime SessionAt          { get; set; }
    public int      VersionId          { get; set; }
    public short    Year               { get; set; }
    public byte     Month              { get; set; }
    public int      VariableId         { get; set; }
    public int?     LanguageId         { get; set; }
    public int?     LobId              { get; set; }
    public int      Step               { get; set; }

    /// <summary>"input" | "imported"</summary>
    public string   TriggerType        { get; set; } = "input";
    public int?     TriggerVariableId  { get; set; }
    public int?     FormulaId          { get; set; }
    public string?  ExpressionUsed     { get; set; }
    public decimal? ValueBefore        { get; set; }
    public decimal? ValueAfter         { get; set; }
    public string?  StatusBefore       { get; set; }
    public string   StatusAfter        { get; set; } = "empty";
}
