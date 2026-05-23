namespace MotorCalculo.Engine.Exceptions;

/// <summary>Base para todas as excepções do motor.</summary>
public class EngineException(string message) : Exception(message);

/// <summary>Erro durante a tokenização de uma expressão.</summary>
public class TokenizerException(string message) : EngineException(message);

/// <summary>Erro durante o parsing de uma expressão.</summary>
public class ParseException(string message) : EngineException(message);

/// <summary>Dependência circular detectada no grafo de fórmulas.</summary>
public class CircularDependencyException(string message) : EngineException(message);
