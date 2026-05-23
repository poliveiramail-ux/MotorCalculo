using MotorCalculo.Engine.Exceptions;

namespace MotorCalculo.Engine.Parsing;

/// <summary>
/// Parser de descida recursiva: tokens → AST.
///
/// Gramática:
///   expr   → term  (('+' | '-') term)*
///   term   → factor (('*' | '/') factor)*
///   factor → NUMBER
///           | '(' expr ')'
///           | PREV     '(' VARIABLE qualifier? ')'
///           | SUM_LOBS '(' VARIABLE qualifier? ')'
///           | SUM_LANGS'(' VARIABLE qualifier? ')'
///           | VARIABLE qualifier?
///
///   qualifier → '[' lang_spec ']' ('[' lob_spec ']')?
///   lang_spec | lob_spec → VARIABLE | '*'
///   '*' e omissão são equivalentes: herda o contexto corrente
/// </summary>
public sealed class Parser(List<Token> tokens)
{
    private int _pos;

    private Token Peek()    => _pos < tokens.Count ? tokens[_pos] : new Token(TokenType.Eof);
    private Token Consume() => tokens[_pos++];

    private bool Match(TokenType type) => Peek().Type == type;

    private Token Expect(TokenType type)
    {
        var token = Consume();
        if (token.Type != type)
            throw new ParseException(
                $"Esperado {type}, obtido {token.Type} na posição {_pos - 1}");
        return token;
    }

    public AstNode Parse()
    {
        if (tokens.Count == 0 || tokens[0].Type == TokenType.Eof)
            throw new ParseException("Expressão vazia");

        var node = ParseExpr();

        if (!Match(TokenType.Eof))
            throw new ParseException($"Token inesperado: {Peek()} na posição {_pos}");

        return node;
    }

    // ── Grammar rules ────────────────────────────────────────

    private AstNode ParseExpr()
    {
        var left = ParseTerm();
        while (Match(TokenType.Plus) || Match(TokenType.Minus))
        {
            var op = Consume().Type == TokenType.Plus ? '+' : '-';
            left = new BinaryOpNode(op, left, ParseTerm());
        }
        return left;
    }

    private AstNode ParseTerm()
    {
        var left = ParseFactor();
        while (Match(TokenType.Multiply) || Match(TokenType.Divide))
        {
            var op = Consume().Type == TokenType.Multiply ? '*' : '/';
            left = new BinaryOpNode(op, left, ParseFactor());
        }
        return left;
    }

    private AstNode ParseFactor()
    {
        var token = Peek();

        if (token.Type == TokenType.Number)
        {
            Consume();
            return new LiteralNode(token.NumValue);
        }

        if (token.Type == TokenType.LParen)
        {
            Consume();
            var expr = ParseExpr();
            Expect(TokenType.RParen);
            return expr;
        }

        if (token.Type == TokenType.Prev)
        {
            Consume();
            Expect(TokenType.LParen);
            var code = Expect(TokenType.Variable).Value!;
            var (lang, lob) = ParseQualifiers();
            Expect(TokenType.RParen);
            return new PrevNode(code, lang, lob);
        }

        if (token.Type == TokenType.SumLobs)
        {
            Consume();
            Expect(TokenType.LParen);
            var code = Expect(TokenType.Variable).Value!;
            var (lang, lob) = ParseQualifiers();
            Expect(TokenType.RParen);
            return new SumLobsNode(code, lang, lob);
        }

        if (token.Type == TokenType.SumLangs)
        {
            Consume();
            Expect(TokenType.LParen);
            var code = Expect(TokenType.Variable).Value!;
            var (lang, lob) = ParseQualifiers();
            Expect(TokenType.RParen);
            return new SumLangsNode(code, lang, lob);
        }

        if (token.Type == TokenType.CountLobs)
        {
            Consume();
            Expect(TokenType.LParen);
            Expect(TokenType.RParen);
            return new CountLobsNode();
        }

        if (token.Type == TokenType.CountLangs)
        {
            Consume();
            Expect(TokenType.LParen);
            Expect(TokenType.RParen);
            return new CountLangsNode();
        }

        if (token.Type == TokenType.Weight)
        {
            // WEIGHT(v_xxx)    → peso global (todos os LOBs de todas as línguas)
            // WEIGHT(v_xxx)[*] → peso relativo à língua actual
            Consume();
            Expect(TokenType.LParen);
            var code = Expect(TokenType.Variable).Value!;
            Expect(TokenType.RParen);
            string? langCode = null;
            if (Match(TokenType.LBracket))
            {
                Consume();                  // [
                var spec = ParseQualSpec();
                Expect(TokenType.RBracket); // ]
                // Só aceita [*] — referência específica de língua foi removida
                if (spec != "*")
                    throw new ParseException(
                        $"WEIGHT só suporta [*] como qualificador. Use WEIGHT_LANG para pesos de língua.");
                langCode = "*";
            }
            return new WeightNode(code, langCode);
        }

        if (token.Type == TokenType.WeightLang)
        {
            // WEIGHT_LANG(v_xxx) — peso da língua actual face a todas as línguas
            Consume();
            Expect(TokenType.LParen);
            var code = Expect(TokenType.Variable).Value!;
            Expect(TokenType.RParen);
            return new WeightLangNode(code);
        }

        if (token.Type == TokenType.Variable)
        {
            Consume();
            var (lang, lob) = ParseQualifiers();
            return new VariableNode(token.Value!, lang, lob);
        }

        throw new ParseException($"Token inesperado: {token} na posição {_pos}");
    }

    /// <summary>
    /// Parseia qualificadores opcionais [lang][lob] após um identificador.
    /// Retorna (null, null) se não houver qualificadores (referência totalmente relativa).
    /// </summary>
    private (string? Lang, string? Lob) ParseQualifiers()
    {
        if (!Match(TokenType.LBracket)) return (null, null);

        Consume(); // [
        var lang = ParseQualSpec();
        Expect(TokenType.RBracket); // ]

        if (!Match(TokenType.LBracket)) return (lang, null);

        Consume(); // [
        var lob = ParseQualSpec();
        Expect(TokenType.RBracket); // ]

        return (lang, lob);
    }

    /// <summary>
    /// Parseia um código de qualificador ou *.
    /// '*' → retorna null (equivalente a omissão: herda contexto corrente).
    /// </summary>
    private string? ParseQualSpec()
    {
        if (Match(TokenType.Multiply))  { Consume(); return null; }
        if (Match(TokenType.Variable))  { return Consume().Value; }
        throw new ParseException(
            $"Qualificador inválido: esperado código ou *, obtido {Peek()}");
    }
}
