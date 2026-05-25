using Microsoft.Extensions.DependencyInjection;
using MotorCalculo.Application.Services;

namespace MotorCalculo.Application.Extensions;

public static class ApplicationExtensions
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.AddScoped<CellService>();
        services.AddScoped<VersionService>();
        services.AddScoped<TemplateService>();
        services.AddScoped<ProjectService>();
        services.AddScoped<AdminService>();
        return services;
    }
}
