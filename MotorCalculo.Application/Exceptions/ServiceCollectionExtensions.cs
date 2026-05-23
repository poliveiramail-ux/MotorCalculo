using Microsoft.Extensions.DependencyInjection;
using MotorCalculo.Application.Services;

namespace MotorCalculo.Application.Extensions;

public static class ServiceCollectionExtensions
{
    /// <summary>
    /// Regista os serviços da camada Application.
    ///
    /// Adicionar em Program.cs APÓS AddInfrastructure:
    ///   builder.Services.AddInfrastructure(builder.Configuration);
    ///   builder.Services.AddApplication();
    /// </summary>
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.AddScoped<CellService>();
        services.AddScoped<VersionService>();
        services.AddScoped<TemplateService>();
        services.AddScoped<ProjectService>();
        return services;
    }
}
