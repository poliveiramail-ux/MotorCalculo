using Xunit;
using FluentAssertions;
using MotorCalculo.Engine.Exceptions;
using MotorCalculo.Engine.Parsing;

namespace MotorCalculo.Engine.Tests;

public class TokenizerTests
{
    [Fact]
    public void SimpleArithmetic_ProducesCorrectTokens()
    {
        var tokens = Tokenizer.Tokenize("v_rec - v_cus");

        tokens.Should().HaveCount(4); // VAR MINUS VAR EOF
        tokens[0].Should().Be(new Token(TokenType.Variable, Value: "v_rec"));
        tokens[1].Should().Be(new Token(TokenType.Minus));
        tokens[2].Should().Be(new Token(TokenType.Variable, Value: "v_cus"));
        tokens[3].Type.Should().Be(TokenType.Eof);
    }

    [Fact]
    public void Number_Integer_ParsedCorrectly()
    {
        var tokens = Tokenizer.Tokenize("100");
        tokens[0].Should().Be(new Token(TokenType.Number, NumValue: 100m));
    }

    [Fact]
    public void Number_Decimal_ParsedCorrectly()
    {
        var tokens = Tokenizer.Tokenize("3.14");
        tokens[0].NumValue.Should().Be(3.14m);
    }

    [Fact]
    public void Keywords_AreCaseInsensitive()
    {
        Tokenizer.Tokenize("PREV(v_sal)")[0].Type.Should().Be(TokenType.Prev);
        Tokenizer.Tokenize("prev(v_sal)")[0].Type.Should().Be(TokenType.Prev);
        Tokenizer.Tokenize("SUM_LOBS(v_rec)")[0].Type.Should().Be(TokenType.SumLobs);
        Tokenizer.Tokenize("SUM_LANGS(v_tot)")[0].Type.Should().Be(TokenType.SumLangs);
    }

    [Fact]
    public void Qualifiers_BracketsTokenized()
    {
        var tokens = Tokenizer.Tokenize("v_rec[PT][ret]");
        tokens.Select(t => t.Type).Should().StartWith(
        [
            TokenType.Variable,
            TokenType.LBracket, TokenType.Variable, TokenType.RBracket,
            TokenType.LBracket, TokenType.Variable, TokenType.RBracket,
        ]);
    }

    [Fact]
    public void Wildcard_InQualifier_Tokenized()
    {
        var tokens = Tokenizer.Tokenize("v_rec[*][ret]");
        tokens[2].Type.Should().Be(TokenType.Multiply); // * é Multiply no tokenizer
    }

    [Fact]
    public void UnknownCharacter_ThrowsTokenizerException()
    {
        var act = () => Tokenizer.Tokenize("v_rec @ v_cus");
        act.Should().Throw<TokenizerException>().WithMessage("*@*");
    }

    [Fact]
    public void Whitespace_IsIgnored()
    {
        var tokens = Tokenizer.Tokenize("  v_rec  +  v_cus  ");
        tokens.Where(t => t.Type != TokenType.Eof).Should().HaveCount(3);
    }

    [Theory]
    [InlineData("v_rec + v_cus * 2")]
    [InlineData("(v_rec - v_cus) / v_rec * 100")]
    [InlineData("PREV(v_sal) + v_mar")]
    [InlineData("SUM_LOBS(v_mar) / SUM_LOBS(v_rec) * 100")]
    [InlineData("v_rec[PT][ret]")]
    [InlineData("v_tot[PT] / v_tot[EN] * 100")]
    public void ValidExpressions_DoNotThrow(string expression)
    {
        var act = () => Tokenizer.Tokenize(expression);
        act.Should().NotThrow();
    }
}
