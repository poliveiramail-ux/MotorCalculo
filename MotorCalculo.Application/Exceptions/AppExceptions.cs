namespace MotorCalculo.Application.Exceptions;

/// <summary>Entidade não encontrada na BD.</summary>
public class NotFoundException(string entity, object id)
    : Exception($"{entity} com id '{id}' não encontrado.");

/// <summary>Pedido inválido — validação falhou.</summary>
public class ValidationException(string message) : Exception(message);
