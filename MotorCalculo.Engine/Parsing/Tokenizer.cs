using MotorCalculo.Engine.Exceptions;

namespace MotorCalculo.Engine.Parsing;

/// <summary>
/// Converte uma string de expressão numa lista de tokens.
/// Suporta: números, variáveis, operadores +−×÷, parêntesis e qualificadores [].
/// Palavras-chave: PREV, SUM_LOBS, SUM_LANGS (case-insensitive).
/// </summary>
public static class Tokenizer
{
    private static readonly Dictionary<string, TokenType> Keywords =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["PREV"]      = TokenType.Prev,
            ["SUM_LOBS"]  = TokenType.SumLobs,
            ["SUM_LANGS"] = TokenType.SumLangs,
        };

    public static List<Token> Tokenize(string expression)
    {
        var tokens = new List<Token>();
        var s = expression.AsSpan().Trim();
        var i = 0;

        while (i < s.Length)
        {
            // Whitespace
            if (char.IsWhiteSpace(s[i])) { i++; continue; }

            // Number: digits or decimal point followed by digit
            if (char.IsDigit(s[i]) || (s[i] == '.' && i + 1 < s.Length && char.IsDigit(s[i + 1])))
            {
                var start = i;
                var hasDot = false;
                while (i < s.Length && (char.IsDigit(s[i]) || (s[i] == '.' && !hasDot)))
                {
                    if (s[i] == '.') hasDot = true;
                    i++;
                }
                var numStr = s[start..i].ToString();
                if (!decimal.TryParse(numStr,
                    System.Globalization.NumberStyles.Number,
                    System.Globalization.CultureInfo.InvariantCulture,
                    out var num))
                    throw new TokenizerException($"Número inválido: '{numStr}'");
                tokens.Add(new Token(TokenType.Number, NumValue: num));
                continue;
            }

            // Identifier or keyword: starts with letter or _
            if (char.IsLetter(s[i]) || s[i] == '_')
            {
                var start = i;
                while (i < s.Length && (char.IsLetterOrDigit(s[i]) || s[i] == '_')) i++;
                var word = s[start..i].ToString();
                var type = Keywords.TryGetValue(word, out var kwType) ? kwType : TokenType.Variable;
                tokens.Add(new Token(type, Value: word));
                continue;
            }

            // Single-character tokens
            var ch = s[i++];
            var token = ch switch
            {
                '+' => new Token(TokenType.Plus),
                '-' => new Token(TokenType.Minus),
                '*' => new Token(TokenType.Multiply),
                '/' => new Token(TokenType.Divide),
                '(' => new Token(TokenType.LParen),
                ')' => new Token(TokenType.RParen),
                '[' => new Token(TokenType.LBracket),
                ']' => new Token(TokenType.RBracket),
                _   => throw new TokenizerException(
                           $"Caracter inesperado '{ch}' na posição {i - 1} de '{expression}'")
            };
            tokens.Add(token);
        }

        tokens.Add(new Token(TokenType.Eof));
        return tokens;
    }
}
