using Xunit;
using FluentAssertions;
using MotorCalculo.Engine.Exceptions;
using MotorCalculo.Engine.Parsing;

namespace MotorCalculo.Engine.Tests;

public class ParserTests
{
    private static AstNode Parse(string expr)
    {
        var tokens = Tokenizer.Tokenize(expr);
        return new Parser(tokens).Parse();
    }

    [Fact]
    public void Literal_ProducesLiteralNode()
    {
        var node = Parse("42");
        node.Should().BeOfType<LiteralNode>()
            .Which.Value.Should().Be(42m);
    }

    [Fact]
    public void Variable_ProducesVariableNode_NoQualifiers()
    {
        var node = Parse("v_rec");
        var v = node.Should().BeOfType<VariableNode>().Subject;
        v.Code.Should().Be("v_rec");
        v.LangCode.Should().BeNull();
        v.LobCode.Should().BeNull();
    }

    [Fact]
    public void Variable_WithLangQualifier()
    {
        var node = Parse("v_rec[PT]");
        var v = node.Should().BeOfType<VariableNode>().Subject;
        v.LangCode.Should().Be("PT");
        v.LobCode.Should().BeNull();
    }

    [Fact]
    public void Variable_WithBothQualifiers()
    {
        var node = Parse("v_rec[PT][ret]");
        var v = node.Should().BeOfType<VariableNode>().Subject;
        v.LangCode.Should().Be("PT");
        v.LobCode.Should().Be("ret");
    }

    [Fact]
    public void Variable_WildcardLang_LobQualifier()
    {
        var node = Parse("v_rec[*][ret]");
        var v = node.Should().BeOfType<VariableNode>().Subject;
        v.LangCode.Should().BeNull(); // * → null (relativo)
        v.LobCode.Should().Be("ret");
    }

    [Fact]
    public void BinaryOp_AdditionAndMultiplication_PrecedenceRespected()
    {
        // v_rec + v_cus * 2 → v_rec + (v_cus * 2)
        var node = Parse("v_rec + v_cus * 2");
        var add = node.Should().BeOfType<BinaryOpNode>().Subject;
        add.Op.Should().Be('+');
        add.Left.Should().BeOfType<VariableNode>();
        var mul = add.Right.Should().BeOfType<BinaryOpNode>().Subject;
        mul.Op.Should().Be('*');
    }

    [Fact]
    public void Parentheses_OverridePrecedence()
    {
        // (v_rec + v_cus) * 2 → multiply at root
        var node = Parse("(v_rec + v_cus) * 2");
        var mul = node.Should().BeOfType<BinaryOpNode>().Subject;
        mul.Op.Should().Be('*');
        mul.Left.Should().BeOfType<BinaryOpNode>()
            .Which.Op.Should().Be('+');
    }

    [Fact]
    public void Prev_ParsedCorrectly()
    {
        var node = Parse("PREV(v_sal)");
        var prev = node.Should().BeOfType<PrevNode>().Subject;
        prev.Code.Should().Be("v_sal");
        prev.LangCode.Should().BeNull();
    }

    [Fact]
    public void Prev_WithQualifiers()
    {
        var node = Parse("PREV(v_sal[PT][ret])");
        var prev = node.Should().BeOfType<PrevNode>().Subject;
        prev.LangCode.Should().Be("PT");
        prev.LobCode.Should().Be("ret");
    }

    [Fact]
    public void SumLobs_ParsedCorrectly()
    {
        var node = Parse("SUM_LOBS(v_mar)");
        var sl = node.Should().BeOfType<SumLobsNode>().Subject;
        sl.Code.Should().Be("v_mar");
    }

    [Fact]
    public void SumLobs_WithLangQualifier()
    {
        var node = Parse("SUM_LOBS(v_rec[PT])");
        var sl = node.Should().BeOfType<SumLobsNode>().Subject;
        sl.LangCode.Should().Be("PT");
    }

    [Fact]
    public void SumLangs_ParsedCorrectly()
    {
        var node = Parse("SUM_LANGS(v_tot)");
        node.Should().BeOfType<SumLangsNode>()
            .Which.Code.Should().Be("v_tot");
    }

    [Fact]
    public void ComplexExpression_ParsedCorrectly()
    {
        // (v_rec - v_cus) / v_rec * 100
        var node = Parse("(v_rec - v_cus) / v_rec * 100");
        node.Should().BeOfType<BinaryOpNode>();
    }

    [Fact]
    public void EmptyExpression_ThrowsParseException()
    {
        var act = () => Parse("");
        act.Should().Throw<ParseException>();
    }

    [Fact]
    public void UnmatchedParenthesis_ThrowsParseException()
    {
        var act = () => Parse("(v_rec + v_cus");
        act.Should().Throw<ParseException>();
    }

    [Fact]
    public void AbsoluteRef_RatioPT_EN()
    {
        var node = Parse("v_tot[PT] / v_tot[EN] * 100");
        node.Should().BeOfType<BinaryOpNode>(); // root = multiply
    }
}
