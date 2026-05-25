using Microsoft.EntityFrameworkCore;
using MotorCalculo.Infrastructure.Entities;

namespace MotorCalculo.Infrastructure.Data;

/// <summary>
/// DbContext principal do MotorCalculo.
/// Configurado via Fluent API — sem atributos nas entidades.
///
/// Connection string esperada em appsettings.json:
///   "ConnectionStrings": { "MotorCalculo": "Server=...;Database=MotorCalculo;..." }
/// </summary>
public sealed class MotorCalculoDbContext(DbContextOptions<MotorCalculoDbContext> options)
    : DbContext(options)
{
    public DbSet<EngineConfigEntity>    EngineConfigs     => Set<EngineConfigEntity>();
    public DbSet<TemplateEntity>        Templates         => Set<TemplateEntity>();
    public DbSet<VariableGroupEntity>   VariableGroups    => Set<VariableGroupEntity>();
    public DbSet<VariableEntity>        Variables         => Set<VariableEntity>();
    public DbSet<FormulaEntity>         Formulas          => Set<FormulaEntity>();
    public DbSet<ProjectEntity>         Projects          => Set<ProjectEntity>();
    public DbSet<LanguageEntity>        Languages         => Set<LanguageEntity>();
    public DbSet<LobEntity>             Lobs              => Set<LobEntity>();
    public DbSet<VersionEntity>         Versions          => Set<VersionEntity>();
    public DbSet<VersionTypeEntity>     VersionTypes      => Set<VersionTypeEntity>();
    public DbSet<CellValueEntity>       CellValues        => Set<CellValueEntity>();
    public DbSet<CalculationLogEntity>  CalculationLogs   => Set<CalculationLogEntity>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        // ── EngineConfig ──────────────────────────────────────
        model.Entity<EngineConfigEntity>(e =>
        {
            e.ToTable("EngineConfig");
            e.HasKey(x => x.Key);
            e.Property(x => x.Key).HasColumnName("key").HasMaxLength(50);
            e.Property(x => x.Value).HasColumnName("value").HasMaxLength(200).IsRequired();
            e.Property(x => x.Description).HasColumnName("description").HasMaxLength(500);
        });

        // ── Template ──────────────────────────────────────────
        model.Entity<TemplateEntity>(e =>
        {
            e.ToTable("Template");
            e.HasKey(x => x.TemplateId);
            e.Property(x => x.TemplateId).HasColumnName("template_id").UseIdentityColumn();
            e.Property(x => x.Code).HasColumnName("code").HasMaxLength(50).IsRequired();
            e.Property(x => x.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
            e.Property(x => x.Description).HasColumnName("description");
            e.Property(x => x.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("GETUTCDATE()");
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at").HasDefaultValueSql("GETUTCDATE()");
            e.HasIndex(x => x.Code).IsUnique();
        });

        // ── VariableGroup ─────────────────────────────────────
        model.Entity<VariableGroupEntity>(e =>
        {
            e.ToTable("VariableGroup");
            e.HasKey(x => x.GroupId);
            e.Property(x => x.GroupId).HasColumnName("group_id").UseIdentityColumn();
            e.Property(x => x.TemplateId).HasColumnName("template_id");
            e.Property(x => x.Code).HasColumnName("code").HasMaxLength(50).IsRequired();
            e.Property(x => x.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
            e.Property(x => x.SortOrder).HasColumnName("sort_order").HasDefaultValue(0);
            e.HasOne(x => x.Template)
             .WithMany(x => x.Groups)
             .HasForeignKey(x => x.TemplateId);
            e.HasIndex(x => new { x.TemplateId, x.Code }).IsUnique();
        });

        // ── Variable ──────────────────────────────────────────
        model.Entity<VariableEntity>(e =>
        {
            e.ToTable("Variable");
            e.HasKey(x => x.VariableId);
            e.Property(x => x.VariableId).HasColumnName("variable_id").UseIdentityColumn();
            e.Property(x => x.TemplateId).HasColumnName("template_id");
            e.Property(x => x.GroupId).HasColumnName("group_id");
            e.Property(x => x.Code).HasColumnName("code").HasMaxLength(50).IsRequired();
            e.Property(x => x.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
            e.Property(x => x.ScopeCode).HasColumnName("scope_code").HasMaxLength(20).IsRequired();
            e.Property(x => x.IsInput).HasColumnName("is_input").HasDefaultValue(false);
            e.Property(x => x.ExternalField).HasColumnName("external_field").HasMaxLength(200);
            e.Property(x => x.SortOrder).HasColumnName("sort_order").HasDefaultValue(0);
            e.Property(x => x.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("GETUTCDATE()");
            e.Property(x => x.UpdatedAt).HasColumnName("updated_at").HasDefaultValueSql("GETUTCDATE()");
            e.HasOne(x => x.Template)
             .WithMany(x => x.Variables)
             .HasForeignKey(x => x.TemplateId);
            e.HasOne(x => x.Group)
             .WithMany(x => x.Variables)
             .HasForeignKey(x => x.GroupId)
             .IsRequired(false);
            e.HasIndex(x => new { x.TemplateId, x.Code }).IsUnique();
        });

        // ── VariableFormula ───────────────────────────────────
        model.Entity<FormulaEntity>(e =>
        {
            e.ToTable("VariableFormula");
            e.HasKey(x => x.FormulaId);
            e.Property(x => x.FormulaId).HasColumnName("formula_id").UseIdentityColumn();
            e.Property(x => x.VariableId).HasColumnName("variable_id");
            e.Property(x => x.FormulaType).HasColumnName("formula_type").HasMaxLength(20).IsRequired();
            e.Property(x => x.Expression).HasColumnName("expression").HasMaxLength(2000).IsRequired();
            e.Property(x => x.TriggerVariableId).HasColumnName("trigger_variable_id");
            e.Property(x => x.SortOrder).HasColumnName("sort_order").HasDefaultValue(0);
            e.HasOne(x => x.Variable)
             .WithMany(x => x.Formulas)
             .HasForeignKey(x => x.VariableId)
             .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.TriggerVariable)
             .WithMany()
             .HasForeignKey(x => x.TriggerVariableId)
             .IsRequired(false)
             .OnDelete(DeleteBehavior.NoAction);
        });

        // ── Project ───────────────────────────────────────────
        model.Entity<ProjectEntity>(e =>
        {
            e.ToTable("Project");
            e.HasKey(x => x.ProjectId);
            e.Property(x => x.ProjectId).HasColumnName("project_id").UseIdentityColumn();
            e.Property(x => x.TemplateId).HasColumnName("template_id");
            e.Property(x => x.Code).HasColumnName("code").HasMaxLength(50).IsRequired();
            e.Property(x => x.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
            e.Property(x => x.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("GETUTCDATE()");
            e.HasOne(x => x.Template)
             .WithMany()
             .HasForeignKey(x => x.TemplateId)
             .OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(x => x.Code).IsUnique();
        });

        // ── Language ──────────────────────────────────────────
        model.Entity<LanguageEntity>(e =>
        {
            e.ToTable("Language");
            e.HasKey(x => x.LanguageId);
            e.Property(x => x.LanguageId).HasColumnName("language_id").UseIdentityColumn();
            e.Property(x => x.ProjectId).HasColumnName("project_id");
            e.Property(x => x.Code).HasColumnName("code").HasMaxLength(20).IsRequired();
            e.Property(x => x.Name).HasColumnName("name").HasMaxLength(100).IsRequired();
            e.Property(x => x.SortOrder).HasColumnName("sort_order").HasDefaultValue(0);
            e.HasOne(x => x.Project)
             .WithMany(x => x.Languages)
             .HasForeignKey(x => x.ProjectId);
            e.HasIndex(x => new { x.ProjectId, x.Code }).IsUnique();
        });

        // ── LOB ───────────────────────────────────────────────
        model.Entity<LobEntity>(e =>
        {
            e.ToTable("LOB");
            e.HasKey(x => x.LobId);
            e.Property(x => x.LobId).HasColumnName("lob_id").UseIdentityColumn();
            e.Property(x => x.LanguageId).HasColumnName("language_id");
            e.Property(x => x.Code).HasColumnName("code").HasMaxLength(50).IsRequired();
            e.Property(x => x.Name).HasColumnName("name").HasMaxLength(100).IsRequired();
            e.Property(x => x.SortOrder).HasColumnName("sort_order").HasDefaultValue(0);
            e.HasOne(x => x.Language)
             .WithMany(x => x.Lobs)
             .HasForeignKey(x => x.LanguageId);
            e.HasIndex(x => new { x.LanguageId, x.Code }).IsUnique();
        });

        // ── VersionType ──────────────────────────────────────
        model.Entity<VersionTypeEntity>(e =>
        {
            e.ToTable("VersionType");
            e.HasKey(x => x.VersionTypeId);
            e.Property(x => x.VersionTypeId).HasColumnName("version_type_id").UseIdentityColumn();
            e.Property(x => x.Code).HasColumnName("code").HasMaxLength(20).IsRequired();
            e.Property(x => x.Name).HasColumnName("name").HasMaxLength(100).IsRequired();
            e.Property(x => x.IsLocked).HasColumnName("is_locked").HasDefaultValue(false);
            e.Property(x => x.SortOrder).HasColumnName("sort_order").HasDefaultValue(0);
        });

        // ── Version ───────────────────────────────────────────
        model.Entity<VersionEntity>(e =>
        {
            e.ToTable("Version");
            e.HasKey(x => x.VersionId);
            e.Property(x => x.VersionId).HasColumnName("version_id").UseIdentityColumn();
            e.Property(x => x.ProjectId).HasColumnName("project_id");
            e.Property(x => x.Code).HasColumnName("code").HasMaxLength(50).IsRequired();
            e.Property(x => x.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
            e.Property(x => x.ClonedFromId).HasColumnName("cloned_from_id");
            e.Property(x => x.ColorIndex).HasColumnName("color_index").HasDefaultValue((byte)0);
            e.Property(x => x.VersionTypeId).HasColumnName("version_type_id");
            e.Property(x => x.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("GETUTCDATE()");
            e.HasOne(x => x.Project)
             .WithMany(x => x.Versions)
             .HasForeignKey(x => x.ProjectId);
            e.HasOne(x => x.VersionType)
             .WithMany()
             .HasForeignKey(x => x.VersionTypeId)
             .IsRequired(false);
            e.HasOne(x => x.ClonedFrom)
             .WithMany()
             .HasForeignKey(x => x.ClonedFromId)
             .IsRequired(false)
             .OnDelete(DeleteBehavior.NoAction);
            e.HasIndex(x => new { x.ProjectId, x.Code }).IsUnique();
        });

        // ── CellValue ─────────────────────────────────────────
        // Incluído no DbContext para modelação do schema.
        // Queries efectivas são feitas via Dapper (CellRepository).
        model.Entity<CellValueEntity>(e =>
        {
            e.ToTable("CellValue");
            e.HasKey(x => x.CellValueId);
            e.Property(x => x.CellValueId).HasColumnName("cell_value_id").UseIdentityColumn();
            e.Property(x => x.VersionId).HasColumnName("version_id");
            e.Property(x => x.Year).HasColumnName("year");
            e.Property(x => x.Month).HasColumnName("month");
            e.Property(x => x.VariableId).HasColumnName("variable_id");
            e.Property(x => x.LanguageId).HasColumnName("language_id");
            e.Property(x => x.LobId).HasColumnName("lob_id");
            e.Property(x => x.Value).HasColumnName("value").HasColumnType("DECIMAL(18,6)");
            e.Property(x => x.Status).HasColumnName("status").HasMaxLength(20).HasDefaultValue("empty");
            e.Property(x => x.Source).HasColumnName("source").HasMaxLength(20).HasDefaultValue("manual");
            e.Property(x => x.FormulaId).HasColumnName("formula_id");
            e.Property(x => x.ImportedAt).HasColumnName("imported_at");
            e.Property(x => x.ComputedAt).HasColumnName("computed_at");
            // period_yyyymm é coluna computada — ignorada pelo EF Core nas escritas
            e.Ignore("PeriodYyyymm");
            e.HasIndex(x => new { x.VersionId, x.Year, x.Month, x.VariableId, x.LanguageId, x.LobId })
             .IsUnique();
        });

        // ── CalculationLog ────────────────────────────────────
        model.Entity<CalculationLogEntity>(e =>
        {
            e.ToTable("CalculationLog");
            e.HasKey(x => x.LogId);
            e.Property(x => x.LogId).HasColumnName("log_id").UseIdentityColumn();
            e.Property(x => x.SessionId).HasColumnName("session_id");
            e.Property(x => x.SessionAt).HasColumnName("session_at").HasDefaultValueSql("GETUTCDATE()");
            e.Property(x => x.VersionId).HasColumnName("version_id");
            e.Property(x => x.Year).HasColumnName("year");
            e.Property(x => x.Month).HasColumnName("month");
            e.Property(x => x.VariableId).HasColumnName("variable_id");
            e.Property(x => x.LanguageId).HasColumnName("language_id");
            e.Property(x => x.LobId).HasColumnName("lob_id");
            e.Property(x => x.Step).HasColumnName("step");
            e.Property(x => x.TriggerType).HasColumnName("trigger_type").HasMaxLength(20);
            e.Property(x => x.TriggerVariableId).HasColumnName("trigger_variable_id");
            e.Property(x => x.FormulaId).HasColumnName("formula_id");
            e.Property(x => x.ExpressionUsed).HasColumnName("expression_used").HasMaxLength(2000);
            e.Property(x => x.ValueBefore).HasColumnName("value_before").HasColumnType("DECIMAL(18,6)");
            e.Property(x => x.ValueAfter).HasColumnName("value_after").HasColumnType("DECIMAL(18,6)");
            e.Property(x => x.StatusBefore).HasColumnName("status_before").HasMaxLength(20);
            e.Property(x => x.StatusAfter).HasColumnName("status_after").HasMaxLength(20);
        });

        // Seed: flag do log de cálculo
        model.Entity<EngineConfigEntity>().HasData(
            new EngineConfigEntity
            {
                Key         = "calculation_log_enabled",
                Value       = "false",
                Description = "Activa o registo detalhado de cálculo. Desactivar em produção."
            }
        );
    }
}
