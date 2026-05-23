using Xunit;
using FluentAssertions;
using MotorCalculo.Engine.Evaluation;
using MotorCalculo.Engine.Models;
using MotorCalculo.Engine.Parsing;

namespace MotorCalculo.Engine.Tests;

/// <summary>
/// Fixture partilhada: projecto PT(ret,emp) / EN(reta), período Jan 2026, versão 1.
/// Espelha os dados iniciais do protótipo JS.
/// </summary>
public class EvaluatorFixture
{
    public const int VersionId  = 1;
    public const int Year       = 2026;
    public const int Month      = 1;
    public const int LangPt     = 10;
    public const int LangEn     = 20;
    public const int LobRet     = 101;
    public const int LobEmp     = 102;
    public const int LobReta    = 201;

    // Variable IDs
    public const int VidRec = 1, VidCus = 2, VidVol = 3, VidPrz = 4;
    public const int VidMar = 5, VidTot = 6, VidGbl = 7;

    public ProjectStructure Project { get; } = new()
    {
        ProjectId = 1,
        Languages =
        [
            new() { LanguageId = LangPt, Code = "PT", Name = "Português",
                Lobs = [new(){LobId=LobRet,Code="ret",Name="Retalho"},
                         new(){LobId=LobEmp,Code="emp",Name="Empresas"}] },
            new() { LanguageId = LangEn, Code = "EN", Name = "English",
                Lobs = [new(){LobId=LobReta,Code="reta",Name="Retail"}] },
        ]
    };

    public IReadOnlyDictionary<string, int> CodeToId { get; } = new Dictionary<string, int>
    {
        ["v_rec"] = VidRec, ["v_cus"] = VidCus, ["v_vol"] = VidVol, ["v_prz"] = VidPrz,
        ["v_mar"] = VidMar, ["v_tot"] = VidTot, ["v_gbl"] = VidGbl,
    };

    // scope de cada variável para cross-scope reference
    public IReadOnlyDictionary<int, string> ScopeById { get; } = new Dictionary<int, string>
    {
        [VidRec] = "lob", [VidCus] = "lob", [VidVol] = "lob", [VidPrz] = "lob",
        [VidMar] = "lob", [VidTot] = "language", [VidGbl] = "template",
    };

    /// <summary>Células iniciais: PT/ret e PT/emp e EN/reta, Jan 2026.</summary>
    public Dictionary<CellKey, CellValue> Cells { get; } = new()
    {
        // PT/Retalho
        [new(VersionId,Year,Month,VidRec,LangPt,LobRet)] = new(){Value=1000m,Status=CellStatus.Ok,Source=CellSource.Manual},
        [new(VersionId,Year,Month,VidCus,LangPt,LobRet)] = new(){Value=600m, Status=CellStatus.Ok,Source=CellSource.Manual},
        [new(VersionId,Year,Month,VidVol,LangPt,LobRet)] = new(){Value=50m,  Status=CellStatus.Ok,Source=CellSource.Manual},
        [new(VersionId,Year,Month,VidPrz,LangPt,LobRet)] = new(){Value=30m,  Status=CellStatus.Ok,Source=CellSource.Manual},
        [new(VersionId,Year,Month,VidMar,LangPt,LobRet)] = new(){Value=400m, Status=CellStatus.Ok,Source=CellSource.Formula},
        // PT/Empresas
        [new(VersionId,Year,Month,VidRec,LangPt,LobEmp)] = new(){Value=2000m,Status=CellStatus.Ok,Source=CellSource.Manual},
        [new(VersionId,Year,Month,VidCus,LangPt,LobEmp)] = new(){Value=1200m,Status=CellStatus.Ok,Source=CellSource.Manual},
        [new(VersionId,Year,Month,VidMar,LangPt,LobEmp)] = new(){Value=800m, Status=CellStatus.Ok,Source=CellSource.Formula},
        // EN/Retail
        [new(VersionId,Year,Month,VidRec,LangEn,LobReta)] = new(){Value=500m, Status=CellStatus.Ok,Source=CellSource.Manual},
        [new(VersionId,Year,Month,VidCus,LangEn,LobReta)] = new(){Value=300m, Status=CellStatus.Ok,Source=CellSource.Manual},
        [new(VersionId,Year,Month,VidMar,LangEn,LobReta)] = new(){Value=200m, Status=CellStatus.Ok,Source=CellSource.Formula},
        // Language scope
        [new(VersionId,Year,Month,VidTot,LangPt,null)] = new(){Value=1200m,Status=CellStatus.Ok,Source=CellSource.Formula},
        [new(VersionId,Year,Month,VidTot,LangEn,null)] = new(){Value=200m, Status=CellStatus.Ok,Source=CellSource.Formula},
        // Template scope
        [new(VersionId,Year,Month,VidGbl,null,null)] = new(){Value=1400m,Status=CellStatus.Ok,Source=CellSource.Formula},
    };

    public EvaluationContext MakeCtx(int? langId = LangPt, int? lobId = LobRet) =>
        new(VersionId, Year, Month, langId, lobId, Project, CodeToId, ScopeById, Cells);
}

public class EvaluatorTests(EvaluatorFixture fx) : IClassFixture<EvaluatorFixture>
{
    private (decimal? Val, CellStatus St) Eval(string expr, int? langId = EvaluatorFixture.LangPt, int? lobId = EvaluatorFixture.LobRet)
    {
        var ast = new Parser(Tokenizer.Tokenize(expr)).Parse();
        return Evaluator.Evaluate(ast, fx.MakeCtx(langId, lobId));
    }

    // ── Literals & variables ──────────────────────────────────

    [Fact] public void Literal() => Eval("100").Should().Be((100m, CellStatus.Ok));

    [Fact] public void Variable_RelativeContext()
    {
        var (val, st) = Eval("v_rec");
        val.Should().Be(1000m);
        st.Should().Be(CellStatus.Ok);
    }

    [Fact] public void Variable_Unknown_ReturnsError()
    {
        var (_, st) = Eval("v_unknown");
        st.Should().Be(CellStatus.Error);
    }

    // ── Arithmetic ────────────────────────────────────────────

    [Fact] public void Subtraction() => Eval("v_rec - v_cus").Should().Be((400m, CellStatus.Ok));

    [Fact] public void Division()    => Eval("v_rec / v_vol").Should().Be((20m, CellStatus.Ok));

    [Fact] public void Division_ByZero_ReturnsError()
    {
        var (_, st) = Eval("v_rec / 0");
        st.Should().Be(CellStatus.Error);
    }

    [Fact] public void Complex_MarginPercent()
    {
        var (val, st) = Eval("(v_rec - v_cus) / v_rec * 100");
        val.Should().Be(40m);
        st.Should().Be(CellStatus.Ok);
    }

    // ── Error propagation ─────────────────────────────────────

    [Fact] public void ErrorPropagates_ThroughAdd()
    {
        var (_, st) = Eval("v_unknown + v_rec");
        st.Should().Be(CellStatus.Error);
    }

    [Fact] public void ErrorPriority_OverEmpty()
    {
        // v_missing_input (Empty) + v_unknown (Error) → Error
        var (_, st) = Eval("v_missing + v_unknown");
        st.Should().Be(CellStatus.Error);
    }

    // ── PREV ──────────────────────────────────────────────────

    [Fact] public void Prev_NoPreviousPeriod_ReturnsZero()
    {
        // Jan 2026 é o primeiro período — PREV → 0
        var (val, st) = Eval("PREV(v_mar)");
        val.Should().Be(0m);
        st.Should().Be(CellStatus.Ok);
    }

    // ── SUM_LOBS ──────────────────────────────────────────────

    [Fact] public void SumLobs_SumsAllLobsOfCurrentLang()
    {
        // PT: ret(400) + emp(800) = 1200
        var (val, st) = Eval("SUM_LOBS(v_mar)", langId: EvaluatorFixture.LangPt, lobId: null);
        val.Should().Be(1200m);
        st.Should().Be(CellStatus.Ok);
    }

    // ── SUM_LANGS ─────────────────────────────────────────────

    [Fact] public void SumLangs_SumsAllLanguages()
    {
        // PT(1200) + EN(200) = 1400
        var (val, st) = Eval("SUM_LANGS(v_tot)", langId: null, lobId: null);
        val.Should().Be(1400m);
        st.Should().Be(CellStatus.Ok);
    }

    // ── Absolute references [lang][lob] ───────────────────────

    [Fact] public void AbsoluteRef_Lang_Lob()
    {
        // v_rec[PT][ret] avaliado em contexto EN/reta → sempre devolve PT/ret = 1000
        var (val, st) = Eval("v_rec[PT][ret]", langId: EvaluatorFixture.LangEn, lobId: EvaluatorFixture.LobReta);
        val.Should().Be(1000m);
        st.Should().Be(CellStatus.Ok);
    }

    [Fact] public void AbsoluteRef_IndexVsPTRet()
    {
        // v_idx EN/reta = v_rec[EN][reta] / v_rec[PT][ret] * 100 = 500/1000*100 = 50
        var (val, st) = Eval("v_rec / v_rec[PT][ret] * 100",
            langId: EvaluatorFixture.LangEn, lobId: EvaluatorFixture.LobReta);
        val.Should().Be(50m);
        st.Should().Be(CellStatus.Ok);
    }

    [Fact] public void AbsoluteRef_LangOnly_RatioPTvsEN()
    {
        // v_tot[PT] / v_tot[EN] * 100 = 1200/200*100 = 600
        var (val, st) = Eval("v_tot[PT] / v_tot[EN] * 100", langId: null, lobId: null);
        val.Should().Be(600m);
        st.Should().Be(CellStatus.Ok);
    }

    [Fact] public void WildcardLang_FixedLob_ReadsCurrentLang()
    {
        // v_rec[*][ret] em contexto PT = v_rec[PT][ret] = 1000
        var (val, st) = Eval("v_rec[*][ret]",
            langId: EvaluatorFixture.LangPt, lobId: EvaluatorFixture.LobRet);
        val.Should().Be(1000m);
        st.Should().Be(CellStatus.Ok);
    }
}
