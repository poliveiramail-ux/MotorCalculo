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

/// <summary>COUNT_LOBS() — número de LOBs da língua actual no projecto.</summary>
public sealed record CountLobsNode : AstNode;

/// <summary>COUNT_LANGS() — número de línguas do projecto.</summary>
public sealed record CountLangsNode : AstNode;

/// <summary>
/// WEIGHT(v_xxx) ou WEIGHT(v_xxx)[*]
/// Peso relativo deste LOB:
///   LangCode = null → todos os LOBs de todas as línguas (denominador global)
///   LangCode = "*"  → LOBs da língua actual (denominador por língua)
/// Lê do snapshot para evitar circularidade.
/// </summary>
public sealed record WeightNode(
    string  Code,
    string? LangCode   // null=global, "*"=língua actual
) : AstNode;

/// <summary>
/// WEIGHT_LANG(v_xxx)
/// Peso relativo da língua actual face a todas as línguas.
/// Numerador:   v_xxx[língua actual, lob=null]
/// Denominador: Σ v_xxx[todas as línguas, lob=null]
/// Lê do snapshot para evitar circularidade.
/// </summary>
public sealed record WeightLangNode(
    string Code
) : AstNode;

/// <summary>Operação binária: +, -, *, /</summary>
public sealed record BinaryOpNode(
    char    Op,
    AstNode Left,
    AstNode Right
) : AstNode;
