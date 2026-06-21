export type ErrorDetails = Record<string, unknown>;

export class AppError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
    message: string,
    public readonly details?: ErrorDetails
  ) {
    super(message);
  }
}

export function badRequest(code: string, message: string, details?: ErrorDetails): AppError {
  return new AppError(400, code, message, details);
}

export function unauthorized(code = "UNAUTHENTICATED", message = "Authentication is required."): AppError {
  return new AppError(401, code, message);
}

export function forbidden(code = "FORBIDDEN", message = "Permission denied.", details?: ErrorDetails): AppError {
  return new AppError(403, code, message, details);
}

export function notFound(code = "NOT_FOUND", message = "Resource not found."): AppError {
  return new AppError(404, code, message);
}

export function conflict(code: string, message: string, details?: ErrorDetails): AppError {
  return new AppError(409, code, message, details);
}

export function unprocessable(code: string, message: string, details?: ErrorDetails): AppError {
  return new AppError(422, code, message, details);
}

export function externalFailure(code: string, message: string, details?: ErrorDetails): AppError {
  return new AppError(502, code, message, details);
}

export function toErrorResponse(error: unknown, requestId: string): { status: number; body: unknown } {
  if (error instanceof AppError) {
    return {
      status: error.httpStatus,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {})
        },
        requestId
      }
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error."
      },
      requestId
    }
  };
}
