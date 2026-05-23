namespace MotorCalculo.Engine.Parsing;

/// <summary>Nó da AST (Abstract Syntax Tree) produzida pelo Parser.</summary>
public abstract record AstNode;

/// <summary>Valor numérico literal: 100, 3.14</summary>
public sealed record LiteralNode(decimal Value) : AstNode;

/// <summary>
/// Referência a uma variável com qualificadores opcionais de contexto.
/// LangCode = null → herda língua do contexto corrente
/// LobCode  = null → herda LOB do contexto corrente
/// Sintaxe: v_rec[PT][ret] → LangCode="PT", LobCode="ret"
///          v_rec[PT]      → LangCode="PT", LobCode=null
///          v_rec[*][ret]  → LangCode=null,  LobCode="ret"
/// </summary>
public sealed record VariableNode(
    string  Code,
    string? LangCode,
    string? LobCode
) : AstNode;

/// <summary>PREV(v_xxx) — valor do período anterior.</summary>
public sealed record PrevNode(
    string  Code,
    string? LangCode,
    string? LobCode
) : AstNode;

/// <summary>SUM_LOBS(v_xxx) — soma dos LOBs da língua resolvida.</summary>
public sealed record SumLobsNode(
    string  Code,
    string? LangCode,
    string? LobCode
) : AstNode;

/// <summary>SUM_LANGS(v_xxx) — soma de todas as línguas.</summary>
public sealed record SumLangsNode(
    string  Code,
    string? LangCode,
    string? LobCode
) : AstNode;

/// <summary>Operação binária: +, -, *, /</summary>
public sealed record BinaryOpNode(
    char    Op,
    AstNode Left,
    AstNode Right
) : AstNode;
