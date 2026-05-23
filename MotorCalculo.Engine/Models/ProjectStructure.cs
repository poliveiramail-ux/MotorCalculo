namespace MotorCalculo.Engine.Models;

/// <summary>
/// Estrutura do projecto necessária para o motor:
/// línguas e LOBs, com os códigos usados nas referências absolutas [PT][ret].
/// </summary>
public sealed record ProjectStructure
{
    public int ProjectId { get; init; }
    public IReadOnlyList<LanguageDefinition> Languages { get; init; } = [];
}

public sealed record LanguageDefinition
{
    public int    LanguageId { get; init; }

    /// <summary>Código usado nas referências absolutas: v_rec[PT]</summary>
    public string Code       { get; init; } = "";
    public string Name       { get; init; } = "";
    public IReadOnlyList<LobDefinition> Lobs { get; init; } = [];
}

public sealed record LobDefinition
{
    public int    LobId { get; init; }

    /// <summary>Código usado nas referências absolutas: v_rec[PT][ret]</summary>
    public string Code  { get; init; } = "";
    public string Name  { get; init; } = "";
}
