namespace MotorCalculo.Engine.Parsing;

public enum TokenType
{
    // Literais e identificadores
    Number,
    Variable,

    // Operadores aritméticos
    Plus, Minus, Multiply, Divide,

    // Parêntesis e qualificadores
    LParen, RParen,
    LBracket, RBracket,  // [ ] — delimitadores de qualificadores de contexto

    // Palavras-chave
    Prev,      // PREV(v_xxx) — período anterior
    SumLobs,   // SUM_LOBS(v_xxx) — soma todos os LOBs da língua
    SumLangs,  // SUM_LANGS(v_xxx) — soma todas as línguas

    Eof
}

/// <summary>
/// Unidade atómica produzida pelo Tokenizer.
/// Value contém o texto do token para Variable.
/// NumValue contém o valor para Number.
/// </summary>
public readonly record struct Token(
    TokenType Type,
    string?   Value    = null,
    decimal   NumValue = 0m
)
{
    public override string ToString() => Type switch
    {
        TokenType.Number   => $"NUM({NumValue})",
        TokenType.Variable => $"VAR({Value})",
        _ => Type.ToString()
    };
}
