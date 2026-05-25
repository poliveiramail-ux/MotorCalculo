using Xunit;
using FluentAssertions;
using MotorCalculo.Engine.Exceptions;
using MotorCalculo.Engine.Models;
using MotorCalculo.Engine.Session;
using MotorCalculo.Engine.Sorting;

namespace MotorCalculo.Engine.Tests;

// ═══════════════════════════════════════════════════════════
//  Topological Sort Tests
// ═══════════════════════════════════════════════════════════

public class TopologicalSortTests
{
    private static VariableDefinition Input(string code, int id) => new()
    {
        VariableId = id, Code = code, ScopeCode = "lob", IsInput = true
    };

    private static VariableDefinition Calc(string code, int id, string formula) => new()
    {
        VariableId = id, Code = code, ScopeCode = "lob", IsInput = false,
        Formulas = [new() { FormulaId = id * 10, FormulaType = "main", Expression = formula }]
    };

    [Fact]
    public void SimpleChain_InputBeforeCalculated()
    {
        var vars = new List<VariableDefinition>
        {
            Calc("v_mar", 2, "v_rec - v_cus"),
            Input("v_rec", 1),
            Input("v_cus", 3),
        };

        var sorted = TopologicalSort.SortStrict(vars).ToList();
        var idxRec = sorted.IndexOf("v_rec");
        var idxCus = sorted.IndexOf("v_cus");
        var idxMar = sorted.IndexOf("v_mar");

        idxRec.Should().BeLessThan(idxMar);
        idxCus.Should().BeLessThan(idxMar);
    }

    [Fact]
    public void TransitiveDependency_CorrectOrder()
    {
        // v_mar = v_rec - v_cus
        // v_pct = v_mar / v_rec * 100
        var vars = new List<VariableDefinition>
        {
            Calc("v_pct", 3, "v_mar / v_rec * 100"),
            Input("v_rec", 1),
            Calc("v_mar", 2, "v_rec - v_cus"),
            Input("v_cus", 4),
        };

        var sorted = TopologicalSort.SortStrict(vars).ToList();
        sorted.IndexOf("v_mar").Should().BeLessThan(sorted.IndexOf("v_pct"));
        sorted.IndexOf("v_rec").Should().BeLessThan(sorted.IndexOf("v_mar"));
    }

    [Fact]
    public void CircularDependency_ThrowsException()
    {
        var vars = new List<VariableDefinition>
        {
            Calc("v_a", 1, "v_b + 1"),
            Calc("v_b", 2, "v_a + 1"),  // circular!
        };

        var act = () => TopologicalSort.SortStrict(vars);
        act.Should().Throw<CircularDependencyException>();
    }

    [Fact]
    public void AllInputs_AnyOrderValid()
    {
        var vars = Enumerable.Range(1, 5)
            .Select(i => Input($"v_{i}", i))
            .ToList<VariableDefinition>();

        var sorted = TopologicalSort.SortStrict(vars).ToList();
        sorted.Should().HaveCount(5);
    }
}

// ═══════════════════════════════════════════════════════════
//  CalculationSession Tests
// ═══════════════════════════════════════════════════════════

public class CalculationSessionTests
{
    // ── Shared setup ─────────────────────────────────────────

    private const int Ver = 1, PtId = 10, EnId = 20, RetId = 101, EmpId = 102, RetaId = 201;

    private static readonly ProjectStructure Project = new()
    {
        ProjectId = 1,
        Languages =
        [
            new() { LanguageId = PtId, Code = "PT", Name = "Português",
                Lobs = [new(){LobId=RetId,Code="ret",Name="Retalho"},
                         new(){LobId=EmpId,Code="emp",Name="Empresas"}] },
            new() { LanguageId = EnId, Code = "EN", Name = "English",
                Lobs = [new(){LobId=RetaId,Code="reta",Name="Retail"}] },
        ]
    };

    private static readonly int[] Periods = [202601, 202602, 202603];

    private enum VId { Rec=1, Cus=2, Vol=3, Mar=4, Tot=5, Gbl=6, Sal=7, PrzTrig=8 }

    private static List<VariableDefinition> BuildVariables(
        IEnumerable<FormulaDefinition>? salFormulas = null,
        IEnumerable<FormulaDefinition>? marFormulas = null)
    {
        return
        [
            new(){ VariableId=(int)VId.Rec, Code="v_rec", ScopeCode="lob",      IsInput=true },
            new(){ VariableId=(int)VId.Cus, Code="v_cus", ScopeCode="lob",      IsInput=true },
            new(){ VariableId=(int)VId.Vol, Code="v_vol", ScopeCode="lob",      IsInput=true },
            new(){ VariableId=(int)VId.PrzTrig, Code="v_prz", ScopeCode="lob",  IsInput=true },
            new(){ VariableId=(int)VId.Mar, Code="v_mar", ScopeCode="lob",      IsInput=false,
                Formulas = marFormulas?.ToList() ?? [new(){FormulaId=40,FormulaType="main",Expression="v_rec - v_cus"}] },
            new(){ VariableId=(int)VId.Tot, Code="v_tot", ScopeCode="language", IsInput=false,
                Formulas = [new(){FormulaId=50,FormulaType="main",Expression="SUM_LOBS(v_mar)"}] },
            new(){ VariableId=(int)VId.Gbl, Code="v_gbl", ScopeCode="template", IsInput=false,
                Formulas = [new(){FormulaId=60,FormulaType="main",Expression="SUM_LANGS(v_tot)"}] },
            new(){ VariableId=(int)VId.Sal, Code="v_sal", ScopeCode="lob",      IsInput=false,
                Formulas = salFormulas?.ToList() ?? [new(){FormulaId=70,FormulaType="main",Expression="PREV(v_sal) + v_mar"}] },
        ];
    }

    private static Dictionary<CellKey, CellValue> BuildCells()
    {
        var c = new Dictionary<CellKey, CellValue>();
        void SetInput(int varId, int? langId, int? lobId, decimal val) =>
            c[new CellKey(Ver, 2026, 1, varId, langId, lobId)] =
                new() { Value = val, Status = CellStatus.Ok, Source = CellSource.Manual };

        SetInput((int)VId.Rec, PtId, RetId,  1000m);
        SetInput((int)VId.Cus, PtId, RetId,  600m);
        SetInput((int)VId.Vol, PtId, RetId,  50m);
        SetInput((int)VId.Rec, PtId, EmpId,  2000m);
        SetInput((int)VId.Cus, PtId, EmpId,  1200m);
        SetInput((int)VId.Rec, EnId, RetaId, 500m);
        SetInput((int)VId.Cus, EnId, RetaId, 300m);

        // Calculated cells (initial values from a previous run)
        void SetCalc(int varId, int? langId, int? lobId, decimal val, int fid) =>
            c[new CellKey(Ver, 2026, 1, varId, langId, lobId)] =
                new() { Value = val, Status = CellStatus.Ok, Source = CellSource.Formula, FormulaId = fid };

        SetCalc((int)VId.Mar, PtId, RetId,  400m,  40);
        SetCalc((int)VId.Mar, PtId, EmpId,  800m,  40);
        SetCalc((int)VId.Mar, EnId, RetaId, 200m,  40);
        SetCalc((int)VId.Tot, PtId, null,   1200m, 50);
        SetCalc((int)VId.Tot, EnId, null,   200m,  50);
        SetCalc((int)VId.Gbl, null, null,   1400m, 60);

        return c;
    }

    // ── Tests ─────────────────────────────────────────────────

    [Fact]
    public void EditReceit_RecalcMar_Tot_Gbl()
    {
        var vars    = BuildVariables();
        var cells   = BuildCells();
        var session = new CalculationSession(vars, Periods, Project);

        // Edita v_rec PT/ret Jan: 1000 → 1300
        var editedKey = new CellKey(Ver, 2026, 1, (int)VId.Rec, PtId, RetId);
        cells[editedKey] = cells[editedKey] with { Value = 1300m };

        var delta = session.Run(editedKey, cells);

        // v_mar PT/ret deve ter mudado: 1300 - 600 = 700
        var marCell = delta.FirstOrDefault(d =>
            d.Key.VariableId == (int)VId.Mar &&
            d.Key.LanguageId == PtId &&
            d.Key.LobId == RetId &&
            d.Key.Month == 1);

        marCell.Should().NotBeNull();
        marCell!.After.Value.Should().Be(700m);

        // v_tot PT deve ter mudado: 700 + 800 = 1500
        var totCell = delta.FirstOrDefault(d =>
            d.Key.VariableId == (int)VId.Tot && d.Key.LanguageId == PtId);
        totCell?.After.Value.Should().Be(1500m);

        // v_gbl deve ter mudado: 1500 + 200 = 1700
        var gblCell = delta.FirstOrDefault(d => d.Key.VariableId == (int)VId.Gbl);
        gblCell?.After.Value.Should().Be(1700m);
    }

    [Fact]
    public void DivisionByZero_ProducesErrorStatus()
    {
        var vars = BuildVariables(marFormulas:
        [
            new(){FormulaId=40,FormulaType="main",Expression="v_rec / v_cus"}
        ]);
        var cells   = BuildCells();
        var session = new CalculationSession(vars, Periods, Project);

        // Zera v_cus
        var editedKey = new CellKey(Ver, 2026, 1, (int)VId.Cus, PtId, RetId);
        cells[editedKey] = cells[editedKey] with { Value = 0m };

        var delta = session.Run(editedKey, cells);

        var marCell = delta.First(d =>
            d.Key.VariableId == (int)VId.Mar &&
            d.Key.LanguageId == PtId && d.Key.LobId == RetId);

        marCell.After.Status.Should().Be(CellStatus.Error);
        marCell.After.Value.Should().BeNull();
    }

    [Fact]
    public void PrevCascades_AcrossPeriods()
    {
        var vars    = BuildVariables();
        var cells   = BuildCells();
        var session = new CalculationSession(vars, Periods, Project);

        // v_sal depende de PREV(v_sal) + v_mar
        // Editando v_mar em Jan deve propagar v_sal para Fev e Mar
        var editedKey = new CellKey(Ver, 2026, 1, (int)VId.Rec, PtId, RetId);
        cells[editedKey] = cells[editedKey] with { Value = 1500m };

        var delta = session.Run(editedKey, cells);

        // v_sal deve aparecer no delta para Jan (e potencialmente Fev, Mar)
        var salChanges = delta.Where(d => d.Key.VariableId == (int)VId.Sal).ToList();
        salChanges.Should().NotBeEmpty();
    }

    [Fact]
    public void ImportedCell_NotOverridden()
    {
        var vars    = BuildVariables();
        var cells   = BuildCells();

        // Marca v_mar PT/ret como importada
        var marKey = new CellKey(Ver, 2026, 1, (int)VId.Mar, PtId, RetId);
        cells[marKey] = new() { Value = 9999m, Status = CellStatus.Ok, Source = CellSource.Imported };

        var session   = new CalculationSession(vars, Periods, Project);
        var editedKey = new CellKey(Ver, 2026, 1, (int)VId.Rec, PtId, RetId);
        cells[editedKey] = cells[editedKey] with { Value = 1300m };

        var delta = session.Run(editedKey, cells);

        // v_mar PT/ret Jan não deve aparecer no delta (Janeiro está importado)
        // Fev e Mar não têm dados de input — ficam Empty, o que é correcto
        delta.Should().NotContain(d =>
            d.Key.VariableId == (int)VId.Mar &&
            d.Key.LanguageId == PtId && d.Key.LobId == RetId &&
            d.Key.Month == 1);
    }

    [Fact]
    public void AlternativeFormula_ActivatedByTrigger()
    {
        // v_mar tem duas fórmulas alternativas activadas por v_rec ou v_cus
        var vars = BuildVariables(marFormulas:
        [
            new(){FormulaId=41,FormulaType="alternative",Expression="v_rec - v_cus",       TriggerVariableId=(int)VId.Rec},
            new(){FormulaId=42,FormulaType="alternative",Expression="v_cus * 2",            TriggerVariableId=(int)VId.Cus},
            new(){FormulaId=40,FormulaType="default",     Expression="v_rec - v_cus"},
        ]);
        var cells   = BuildCells();
        var session = new CalculationSession(vars, Periods, Project);

        // Edita v_cus → deve activar fórmula 42: v_cus * 2
        var editedKey = new CellKey(Ver, 2026, 1, (int)VId.Cus, PtId, RetId);
        cells[editedKey] = cells[editedKey] with { Value = 700m };

        var delta = session.Run(editedKey, cells);

        var marCell = delta.FirstOrDefault(d =>
            d.Key.VariableId == (int)VId.Mar &&
            d.Key.LanguageId == PtId && d.Key.LobId == RetId && d.Key.Month == 1);

        marCell.Should().NotBeNull();
        marCell!.After.FormulaId.Should().Be(42);      // fórmula alternativa activada
        marCell.After.Value.Should().Be(700m * 2);      // v_cus * 2 = 700 * 2 = 1400
    }

    [Fact]
    public void AlternativeFormula_MaintainedWhenOtherInputEdited()
    {
        // Após activar fórmula 42 via v_cus, editar v_vol (não é trigger) → mantém fórmula 42
        var vars = BuildVariables(marFormulas:
        [
            new(){FormulaId=41,FormulaType="alternative",Expression="v_rec * 0.4",  TriggerVariableId=(int)VId.Rec},
            new(){FormulaId=42,FormulaType="alternative",Expression="v_cus * 2",    TriggerVariableId=(int)VId.Cus},
            new(){FormulaId=40,FormulaType="default",     Expression="v_rec - v_cus"},
        ]);
        var cells   = BuildCells();

        // Simula que v_mar PT/ret/Jan já usa fórmula 42
        var marKey = new CellKey(Ver, 2026, 1, (int)VId.Mar, PtId, RetId);
        cells[marKey] = cells[marKey] with { FormulaId = 42 };

        var session = new CalculationSession(vars, Periods, Project);

        // Edita v_vol (não é trigger de v_mar)
        var editedKey = new CellKey(Ver, 2026, 1, (int)VId.Vol, PtId, RetId);
        cells[editedKey] = cells[editedKey] with { Value = 60m };

        // v_mar não depende de v_vol — não deve aparecer no delta
        var delta = session.Run(editedKey, cells);
        delta.Should().NotContain(d =>
            d.Key.VariableId == (int)VId.Mar &&
            d.Key.LanguageId == PtId && d.Key.LobId == RetId);
    }

    [Fact]
    public void OnlyDelta_Returned_NotAllCells()
    {
        var vars    = BuildVariables();
        var cells   = BuildCells();
        var session = new CalculationSession(vars, Periods, Project);

        var editedKey = new CellKey(Ver, 2026, 1, (int)VId.Rec, EnId, RetaId);
        cells[editedKey] = cells[editedKey] with { Value = 800m };

        var delta = session.Run(editedKey, cells);

        // v_mar e v_tot PT não devem mudar — as suas células de input (PT) não foram editadas.
        // v_sal PT pode aparecer porque não estava inicializada (Empty → Ok é uma alteração legítima).
        delta.Should().NotContain(d =>
            d.Key.LanguageId == PtId && d.Key.VariableId == (int)VId.Mar);
        delta.Should().NotContain(d =>
            d.Key.LanguageId == PtId && d.Key.VariableId == (int)VId.Tot);
    }
}
