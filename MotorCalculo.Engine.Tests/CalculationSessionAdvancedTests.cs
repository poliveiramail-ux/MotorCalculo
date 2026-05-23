using Xunit;
using FluentAssertions;
using MotorCalculo.Engine.Models;
using MotorCalculo.Engine.Session;

namespace MotorCalculo.Engine.Tests;

/// <summary>
/// Cobertura adicional da CalculationSession:
///   - SUM_LANGS: agrega todas as línguas; propaga erros cross-language
///   - SUM_LOBS: erro num LOB propaga para o total da língua
///   - Cadeia de erros via PREV entre períodos
///   - Referências absolutas (v_rec[PT][ret]) em variáveis template
///   - Wildcard de língua ([*]) com LOB fixo em contexto de sessão
/// </summary>
public class CalculationSessionAdvancedTests
{
    // ── Setup ────────────────────────────────────────────────────────

    private const int Ver    = 1;
    private const int PtId   = 10;
    private const int EnId   = 20;
    private const int RetId  = 101;   // PT / Retalho
    private const int EmpId  = 102;   // PT / Empresas
    private const int RetaId = 201;   // EN / Retail

    private static readonly ProjectStructure Project = new()
    {
        ProjectId = 1,
        Languages =
        [
            new() { LanguageId = PtId, Code = "PT", Name = "Portugues",
                Lobs =
                [
                    new() { LobId = RetId,  Code = "ret",  Name = "Retalho"  },
                    new() { LobId = EmpId,  Code = "emp",  Name = "Empresas" },
                ] },
            new() { LanguageId = EnId, Code = "EN", Name = "English",
                Lobs =
                [
                    new() { LobId = RetaId, Code = "reta", Name = "Retail" },
                ] },
        ]
    };

    private static readonly int[] Periods = [202601, 202602, 202603];

    private enum VId { Rec = 1, Cus = 2, Vol = 3, Mar = 4, Tot = 5, Gbl = 6, Sal = 7 }

    private const int VIdCross = 9;
    private const int VIdIdx   = 10;

    /// <summary>
    /// Constroi as variaveis do projecto.
    /// <paramref name="marFormulas"/> substitui a formula padrao de v_mar.
    /// </summary>
    private static List<VariableDefinition> BuildVariables(
        IEnumerable<FormulaDefinition>? marFormulas = null) =>
    [
        new() { VariableId = (int)VId.Rec, Code = "v_rec", ScopeCode = "lob",      IsInput = true },
        new() { VariableId = (int)VId.Cus, Code = "v_cus", ScopeCode = "lob",      IsInput = true },
        new() { VariableId = (int)VId.Vol, Code = "v_vol", ScopeCode = "lob",      IsInput = true },
        new()
        {
            VariableId = (int)VId.Mar, Code = "v_mar", ScopeCode = "lob", IsInput = false,
            Formulas   = marFormulas?.ToList()
                         ?? [new() { FormulaId = 40, FormulaType = "main", Expression = "v_rec - v_cus" }]
        },
        new()
        {
            VariableId = (int)VId.Tot, Code = "v_tot", ScopeCode = "language", IsInput = false,
            Formulas   = [new() { FormulaId = 50, FormulaType = "main", Expression = "SUM_LOBS(v_mar)" }]
        },
        new()
        {
            VariableId = (int)VId.Gbl, Code = "v_gbl", ScopeCode = "template", IsInput = false,
            Formulas   = [new() { FormulaId = 60, FormulaType = "main", Expression = "SUM_LANGS(v_tot)" }]
        },
        new()
        {
            VariableId = (int)VId.Sal, Code = "v_sal", ScopeCode = "lob", IsInput = false,
            Formulas   = [new() { FormulaId = 70, FormulaType = "main", Expression = "PREV(v_sal) + v_mar" }]
        },
    ];

    /// <summary>Estado inicial: periodo 1 com inputs e calculados coerentes.</summary>
    private static Dictionary<CellKey, CellValue> BuildCells()
    {
        var c = new Dictionary<CellKey, CellValue>();

        void AddInput(int varId, int? lang, int? lob, decimal val) =>
            c[new CellKey(Ver, 2026, 1, varId, lang, lob)] =
                new() { Value = val, Status = CellStatus.Ok, Source = CellSource.Manual };

        void AddCalc(int varId, int? lang, int? lob, decimal val, int fid) =>
            c[new CellKey(Ver, 2026, 1, varId, lang, lob)] =
                new() { Value = val, Status = CellStatus.Ok, Source = CellSource.Formula, FormulaId = fid };

        // Inputs – periodo 1
        AddInput((int)VId.Rec, PtId, RetId,  1000m);
        AddInput((int)VId.Cus, PtId, RetId,   600m);
        AddInput((int)VId.Rec, PtId, EmpId,  2000m);
        AddInput((int)VId.Cus, PtId, EmpId,  1200m);
        AddInput((int)VId.Rec, EnId, RetaId,  500m);
        AddInput((int)VId.Cus, EnId, RetaId,  300m);

        // Calculados – periodo 1 (v_mar PT/ret=400, PT/emp=800, EN/reta=200)
        AddCalc((int)VId.Mar, PtId, RetId,   400m, 40);
        AddCalc((int)VId.Mar, PtId, EmpId,   800m, 40);
        AddCalc((int)VId.Mar, EnId, RetaId,  200m, 40);
        AddCalc((int)VId.Tot, PtId, null,   1200m, 50);
        AddCalc((int)VId.Tot, EnId, null,    200m, 50);
        AddCalc((int)VId.Gbl, null, null,   1400m, 60);

        return c;
    }

    // ── SUM_LANGS ────────────────────────────────────────────────────

    /// <summary>
    /// Editar EN actualiza v_gbl via SUM_LANGS mas nao toca nas celulas PT.
    /// v_gbl = PT/v_tot(1200) + EN/v_tot(500) = 1700.
    /// </summary>
    [Fact]
    public void SumLangs_EditEN_UpdatesGlobal_LeavesPTUnchanged()
    {
        var vars    = BuildVariables();
        var cells   = BuildCells();
        var session = new CalculationSession(vars, Periods, Project);

        // EN/reta/v_rec: 500 -> 800
        var editedKey = new CellKey(Ver, 2026, 1, (int)VId.Rec, EnId, RetaId);
        cells[editedKey] = cells[editedKey] with { Value = 800m };

        var delta = session.Run(editedKey, cells);

        // v_mar EN/reta: 800 - 300 = 500
        delta.Should().Contain(d =>
            d.Key.VariableId == (int)VId.Mar &&
            d.Key.LanguageId == EnId && d.Key.LobId == RetaId &&
            d.Key.Month == 1 && d.After.Value == 500m);

        // v_tot EN: SUM_LOBS = 500 (EN so tem reta)
        delta.Should().Contain(d =>
            d.Key.VariableId == (int)VId.Tot &&
            d.Key.LanguageId == EnId && d.Key.Month == 1 &&
            d.After.Value == 500m);

        // v_gbl: PT/v_tot(1200) + EN/v_tot(500) = 1700
        delta.Should().Contain(d =>
            d.Key.VariableId == (int)VId.Gbl && d.Key.Month == 1 &&
            d.After.Value == 1700m);

        // PT nao deve aparecer no delta
        delta.Should().NotContain(d =>
            d.Key.LanguageId == PtId && d.Key.VariableId == (int)VId.Mar);
        delta.Should().NotContain(d =>
            d.Key.LanguageId == PtId && d.Key.VariableId == (int)VId.Tot);
    }

    /// <summary>
    /// Editar PT actualiza v_gbl usando o EN/v_tot existente (sem recalcular EN).
    /// v_gbl = PT/v_tot(1600) + EN/v_tot(200) = 1800.
    /// </summary>
    [Fact]
    public void SumLangs_EditPT_GlobalUsesExistingEN_Total()
    {
        var vars    = BuildVariables();
        var cells   = BuildCells();
        var session = new CalculationSession(vars, Periods, Project);

        // PT/ret/v_rec: 1000 -> 1400
        var editedKey = new CellKey(Ver, 2026, 1, (int)VId.Rec, PtId, RetId);
        cells[editedKey] = cells[editedKey] with { Value = 1400m };

        var delta = session.Run(editedKey, cells);

        // v_mar PT/ret: 1400 - 600 = 800
        delta.Should().Contain(d =>
            d.Key.VariableId == (int)VId.Mar &&
            d.Key.LanguageId == PtId && d.Key.LobId == RetId &&
            d.After.Value == 800m);

        // v_tot PT: 800(ret) + 800(emp, sem alteracao) = 1600
        delta.Should().Contain(d =>
            d.Key.VariableId == (int)VId.Tot &&
            d.Key.LanguageId == PtId &&
            d.After.Value == 1600m);

        // v_gbl: PT/v_tot(1600) + EN/v_tot(200, nao alterado) = 1800
        delta.Should().Contain(d =>
            d.Key.VariableId == (int)VId.Gbl &&
            d.After.Value == 1800m);

        // EN nao deve aparecer no delta
        delta.Should().NotContain(d =>
            d.Key.LanguageId == EnId && d.Key.VariableId == (int)VId.Mar);
    }

    /// <summary>
    /// Erro num LOB EN propaga: v_mar -> v_tot EN -> v_gbl (SUM_LANGS).
    /// </summary>
    [Fact]
    public void SumLangs_ErrorInOneLang_PropagatesGlobal()
    {
        var vars = BuildVariables(marFormulas:
        [
            new() { FormulaId = 40, FormulaType = "main", Expression = "v_rec / v_cus" }
        ]);
        var cells   = BuildCells();
        var session = new CalculationSession(vars, Periods, Project);

        // EN/reta/v_cus = 0 -> v_mar EN/reta = Error
        var editedKey = new CellKey(Ver, 2026, 1, (int)VId.Cus, EnId, RetaId);
        cells[editedKey] = cells[editedKey] with { Value = 0m };

        var delta = session.Run(editedKey, cells);

        delta.Should().Contain(d =>
            d.Key.VariableId == (int)VId.Mar &&
            d.Key.LanguageId == EnId &&
            d.After.Status == CellStatus.Error,
            "v_mar EN deve ser Error");

        delta.Should().Contain(d =>
            d.Key.VariableId == (int)VId.Tot &&
            d.Key.LanguageId == EnId &&
            d.After.Status == CellStatus.Error,
            "v_tot EN: SUM_LOBS com Error -> Error");

        delta.Should().Contain(d =>
            d.Key.VariableId == (int)VId.Gbl &&
            d.After.Status == CellStatus.Error,
            "v_gbl: SUM_LANGS(Error, 200) -> Error");
    }

    // ── SUM_LOBS error chain ─────────────────────────────────────────

    /// <summary>
    /// Erro num LOB PT propaga para v_tot PT via SUM_LOBS, sem afectar o outro LOB.
    /// PT/emp/v_mar (800) permanece no delta pois nao foi recalculado.
    /// </summary>
    [Fact]
    public void SumLobs_ErrorInOneLob_PropagatesLanguageTotal()
    {
        var vars = BuildVariables(marFormulas:
        [
            new() { FormulaId = 40, FormulaType = "main", Expression = "v_rec / v_cus" }
        ]);
        var cells   = BuildCells();
        var session = new CalculationSession(vars, Periods, Project);

        // PT/ret/v_cus = 0 -> v_mar PT/ret = Error; PT/emp fica inalterado (800)
        var editedKey = new CellKey(Ver, 2026, 1, (int)VId.Cus, PtId, RetId);
        cells[editedKey] = cells[editedKey] with { Value = 0m };

        var delta = session.Run(editedKey, cells);

        // v_mar PT/ret deve ser Error
        delta.Should().Contain(d =>
            d.Key.VariableId == (int)VId.Mar &&
            d.Key.LanguageId == PtId && d.Key.LobId == RetId &&
            d.After.Status == CellStatus.Error);

        // PT/emp/v_mar NAO deve aparecer no delta (nao foi afectado)
        delta.Should().NotContain(d =>
            d.Key.VariableId == (int)VId.Mar &&
            d.Key.LanguageId == PtId && d.Key.LobId == EmpId);

        // v_tot PT: SUM_LOBS(Error, 800) = Error
        delta.Should().Contain(d =>
            d.Key.VariableId == (int)VId.Tot &&
            d.Key.LanguageId == PtId &&
            d.After.Status == CellStatus.Error,
            "SUM_LOBS com um LOB em Error deve propagar Error");

        // v_gbl: SUM_LANGS(Error, 200) = Error
        delta.Should().Contain(d =>
            d.Key.VariableId == (int)VId.Gbl &&
            d.After.Status == CellStatus.Error);
    }

    // ── PREV error chain ─────────────────────────────────────────────

    /// <summary>
    /// Erro no periodo 1 propaga para o periodo 2 via PREV(v_sal).
    ///
    /// Periodo 1: v_cus=0 -> v_mar=Error -> v_sal = 0(sem prev) + Error = Error
    /// Periodo 2: v_sal = PREV(v_sal)[Error] + v_mar[OK] = Error
    /// </summary>
    [Fact]
    public void ErrorChain_Prev_PropagatesAcrossPeriods()
    {
        var vars = BuildVariables(marFormulas:
        [
            new() { FormulaId = 40, FormulaType = "main", Expression = "v_rec / v_cus" }
        ]);
        var cells = BuildCells();

        // Inputs para o periodo 2 com v_cus != 0 (v_mar[2] e OK)
        // Assim o erro em v_sal[2] vem apenas do PREV, nao de v_mar[2]
        cells[new CellKey(Ver, 2026, 2, (int)VId.Rec, PtId, RetId)] =
            new() { Value = 1000m, Status = CellStatus.Ok, Source = CellSource.Manual };
        cells[new CellKey(Ver, 2026, 2, (int)VId.Cus, PtId, RetId)] =
            new() { Value = 500m,  Status = CellStatus.Ok, Source = CellSource.Manual };

        var session = new CalculationSession(vars, Periods, Project);

        // Periodo 1: v_cus = 0 -> v_mar = Error
        var editedKey = new CellKey(Ver, 2026, 1, (int)VId.Cus, PtId, RetId);
        cells[editedKey] = cells[editedKey] with { Value = 0m };

        var delta = session.Run(editedKey, cells);

        // Periodo 1: v_sal = 0(sem PREV) + Error = Error
        delta.Should().Contain(d =>
            d.Key.VariableId == (int)VId.Sal &&
            d.Key.LanguageId == PtId && d.Key.LobId == RetId &&
            d.Key.Month == 1 &&
            d.After.Status == CellStatus.Error,
            "v_sal periodo 1 deve ser Error");

        // Periodo 2: v_sal = PREV(v_sal)[Error] + v_mar[2=OK] = Error
        delta.Should().Contain(d =>
            d.Key.VariableId == (int)VId.Sal &&
            d.Key.LanguageId == PtId && d.Key.LobId == RetId &&
            d.Key.Month == 2 &&
            d.After.Status == CellStatus.Error,
            "v_sal periodo 2 deve ser Error porque PREV le o Error do periodo 1");
    }

    // ── Referencias absolutas cross-language ─────────────────────────

    /// <summary>
    /// Variavel template com formula "v_rec[PT][ret] / v_rec[EN][reta] * 100".
    /// Editar PT/ret/v_rec actualiza v_cross: 1500/500*100 = 300.
    /// </summary>
    [Fact]
    public void AbsoluteRef_TemplateVar_CrossLanguage_UpdatesWhenPTEdited()
    {
        var vars = BuildVariables();
        vars.Add(new VariableDefinition
        {
            VariableId = VIdCross,
            Code       = "v_cross",
            ScopeCode  = "template",
            IsInput    = false,
            Formulas   =
            [
                new()
                {
                    FormulaId   = 90,
                    FormulaType = "main",
                    Expression  = "v_rec[PT][ret] / v_rec[EN][reta] * 100"
                }
            ]
        });
        var cells   = BuildCells();
        var session = new CalculationSession(vars, Periods, Project);

        // PT/ret/v_rec: 1000 -> 1500  =>  v_cross = 1500/500*100 = 300
        var editedKey = new CellKey(Ver, 2026, 1, (int)VId.Rec, PtId, RetId);
        cells[editedKey] = cells[editedKey] with { Value = 1500m };

        var delta = session.Run(editedKey, cells);

        var crossCell = delta.FirstOrDefault(d =>
            d.Key.VariableId == VIdCross && d.Key.Month == 1);

        crossCell.Should().NotBeNull(
            "v_cross deve recalcular quando v_rec[PT][ret] muda");
        crossCell!.After.Value.Should().Be(300m);
    }

    /// <summary>
    /// Mesma variavel v_cross, mas editar EN/reta/v_rec.
    /// v_cross = 1000 / 800 * 100 = 125.
    /// </summary>
    [Fact]
    public void AbsoluteRef_TemplateVar_CrossLanguage_UpdatesWhenENEdited()
    {
        var vars = BuildVariables();
        vars.Add(new VariableDefinition
        {
            VariableId = VIdCross,
            Code       = "v_cross",
            ScopeCode  = "template",
            IsInput    = false,
            Formulas   =
            [
                new()
                {
                    FormulaId   = 90,
                    FormulaType = "main",
                    Expression  = "v_rec[PT][ret] / v_rec[EN][reta] * 100"
                }
            ]
        });
        var cells   = BuildCells();
        var session = new CalculationSession(vars, Periods, Project);

        // EN/reta/v_rec: 500 -> 800  =>  v_cross = 1000/800*100 = 125
        var editedKey = new CellKey(Ver, 2026, 1, (int)VId.Rec, EnId, RetaId);
        cells[editedKey] = cells[editedKey] with { Value = 800m };

        var delta = session.Run(editedKey, cells);

        var crossCell = delta.FirstOrDefault(d =>
            d.Key.VariableId == VIdCross && d.Key.Month == 1);

        crossCell.Should().NotBeNull(
            "v_cross depende de v_rec[EN][reta] e deve recalcular");
        crossCell!.After.Value.Should().Be(125m);
    }

    // ── Wildcard de lingua [*] ────────────────────────────────────────

    /// <summary>
    /// Variavel language-scoped com formula "v_rec[*][ret]".
    /// [*] resolve para a lingua do contexto actual.
    ///
    /// Editar PT/ret/v_rec:
    ///   - v_idx[PT] actualiza para 1200
    ///   - v_idx[EN] NAO aparece no delta (editar PT nao afecta EN)
    /// </summary>
    [Fact]
    public void WildcardLang_FixedLob_OnlyAffectsEditedLanguage()
    {
        var vars = BuildVariables();
        vars.Add(new VariableDefinition
        {
            VariableId = VIdIdx,
            Code       = "v_idx",
            ScopeCode  = "language",
            IsInput    = false,
            Formulas   =
            [
                new()
                {
                    FormulaId   = 91,
                    FormulaType = "main",
                    Expression  = "v_rec[*][ret]"   // lingua actual, LOB fixo
                }
            ]
        });
        var cells   = BuildCells();
        var session = new CalculationSession(vars, Periods, Project);

        // PT/ret/v_rec: 1000 -> 1200
        var editedKey = new CellKey(Ver, 2026, 1, (int)VId.Rec, PtId, RetId);
        cells[editedKey] = cells[editedKey] with { Value = 1200m };

        var delta = session.Run(editedKey, cells);

        // v_idx[PT]: v_rec[PT][ret] = 1200
        var idxPt = delta.FirstOrDefault(d =>
            d.Key.VariableId == VIdIdx &&
            d.Key.LanguageId == PtId &&
            d.Key.Month == 1);

        idxPt.Should().NotBeNull(
            "v_idx[PT] deve recalcular quando v_rec[PT][ret] muda");
        idxPt!.After.Value.Should().Be(1200m);

        // v_idx[EN] NAO deve aparecer no delta
        delta.Should().NotContain(d =>
            d.Key.VariableId == VIdIdx && d.Key.LanguageId == EnId,
            "editar PT/ret/v_rec nao deve recalcular v_idx[EN]");
    }

    /// <summary>
    /// Editar EN/reta/v_rec nao activa v_idx[PT] (formula usa [*][ret],
    /// e a sessao so recalcula o contexto da lingua editada).
    /// </summary>
    [Fact]
    public void WildcardLang_FixedLob_EditOtherLang_DoesNotAffectPT()
    {
        var vars = BuildVariables();
        vars.Add(new VariableDefinition
        {
            VariableId = VIdIdx,
            Code       = "v_idx",
            ScopeCode  = "language",
            IsInput    = false,
            Formulas   =
            [
                new() { FormulaId = 91, FormulaType = "main", Expression = "v_rec[*][ret]" }
            ]
        });
        var cells   = BuildCells();
        var session = new CalculationSession(vars, Periods, Project);

        // Edita EN/reta/v_rec
        var editedKey = new CellKey(Ver, 2026, 1, (int)VId.Rec, EnId, RetaId);
        cells[editedKey] = cells[editedKey] with { Value = 800m };

        var delta = session.Run(editedKey, cells);

        // v_idx[PT] NAO deve aparecer no delta
        delta.Should().NotContain(d =>
            d.Key.VariableId == VIdIdx && d.Key.LanguageId == PtId,
            "editar EN nao deve recalcular v_idx[PT]");
    }
}
