using System.Net;
using System.Text.Json;
using MotorCalculo.Application.Exceptions;

namespace MotorCalculo.Api.Middleware;

/// <summary>
/// Intercepta excepções não tratadas e converte-as em respostas HTTP com JSON.
/// Evita stack traces expostos ao cliente em produção.
/// </summary>
public sealed class ErrorHandlingMiddleware(RequestDelegate next, ILogger<ErrorHandlingMiddleware> logger)
{
    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await next(context);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Excepção não tratada: {Message}", ex.Message);
            await HandleExceptionAsync(context, ex);
        }
    }

    private static Task HandleExceptionAsync(HttpContext context, Exception ex)
    {
        var (status, message) = ex switch
        {
            NotFoundException  nfe => (HttpStatusCode.NotFound,            nfe.Message),
            ValidationException ve => (HttpStatusCode.BadRequest,          ve.Message),
            InvalidOperationException ioe => (HttpStatusCode.Conflict,     ioe.Message),
            _                              => (HttpStatusCode.InternalServerError, "Erro interno do servidor.")
        };

        context.Response.ContentType = "application/json";
        context.Response.StatusCode  = (int)status;

        var body = JsonSerializer.Serialize(new { error = message }, JsonOpts);
        return context.Response.WriteAsync(body);
    }
}
