export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ValidationError extends AppError {
  constructor(
    message: string,
    code = "validation_error",
    statusCode = 400,
    details?: unknown
  ) {
    super(code, message, statusCode, details);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, code = "not_found") {
    super(code, message, 404);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = "conflict") {
    super(code, message, 409);
    this.name = "ConflictError";
  }
}

