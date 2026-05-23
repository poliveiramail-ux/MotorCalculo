using MotorCalculo.Api.Middleware;
using MotorCalculo.Application.Extensions;
using MotorCalculo.Infrastructure.Extensions;

var builder = WebApplication.CreateBuilder(args);

// ── Serviços ──────────────────────────────────────────────────

// Infrastructure: DbContext, Repositórios (EF Core + Dapper)
builder.Services.AddInfrastructure(builder.Configuration);

// Application: CellService, VersionService, etc.
builder.Services.AddApplication();

// API
builder.Services.AddControllers();

// Swagger — disponível em /swagger (desactivar em produção se necessário)
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new() { Title = "Motor de Cálculo API", Version = "v1" });
});

// CORS — ajustar a origem quando o frontend estiver configurado
builder.Services.AddCors(opts =>
    opts.AddPolicy("Frontend", policy =>
        policy.WithOrigins(
                builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
                ?? ["http://localhost:5173"])   // Vite dev server por omissão
              .AllowAnyMethod()
              .AllowAnyHeader()));

// ── Pipeline ──────────────────────────────────────────────────

var app = builder.Build();

// Middleware de erro — primeiro no pipeline, apanha tudo
app.UseMiddleware<ErrorHandlingMiddleware>();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(c => c.SwaggerEndpoint("/swagger/v1/swagger.json", "Motor de Cálculo v1"));
}

app.UseCors("Frontend");
app.UseAuthorization();
app.MapControllers();

app.Run();
