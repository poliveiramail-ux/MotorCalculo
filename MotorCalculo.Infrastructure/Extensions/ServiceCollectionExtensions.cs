using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using MotorCalculo.Infrastructure.Data;
using MotorCalculo.Infrastructure.Repositories;
using MotorCalculo.Infrastructure.Repositories.Interfaces;

namespace MotorCalculo.Infrastructure.Extensions;

public static class ServiceCollectionExtensions
{
    /// <summary>
    /// Regista todos os serviços da camada Infrastructure no DI container.
    ///
    /// Adicionar em Program.cs:
    ///   builder.Services.AddInfrastructure(builder.Configuration);
    ///
    /// Connection string em appsettings.json:
    ///   "ConnectionStrings": {
    ///     "MotorCalculo": "Server=localhost;Database=MotorCalculo;
    ///                      Integrated Security=true;TrustServerCertificate=true;"
    ///   }
    /// </summary>
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        // DbContext
        services.AddDbContext<MotorCalculoDbContext>(opts =>
            opts.UseSqlServer(
                configuration.GetConnectionString("MotorCalculo"),
                sql =>
                {
                    sql.CommandTimeout(120);
                    sql.EnableRetryOnFailure(maxRetryCount: 3);
                }));

        // Repositórios — Scoped: um por pedido HTTP
        services.AddScoped<ITemplateRepository, TemplateRepository>();
        services.AddScoped<IProjectRepository,  ProjectRepository>();
        services.AddScoped<IVersionRepository,  VersionRepository>();
        services.AddScoped<ICellRepository,     CellRepository>();

        return services;
    }
}
