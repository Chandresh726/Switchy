import { NextResponse } from "next/server";
import { z } from "zod";

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string, code = "validation_error", statusCode = 400) {
    super(code, message, statusCode);
    this.name = "ValidationError";
  }
}

export function handleApiError(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.statusCode }
    );
  }

  if (error instanceof SyntaxError) {
    return NextResponse.json(
      { error: "Invalid JSON in request body", code: "invalid_json" },
      { status: 400 }
    );
  }

  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: "Invalid request payload",
        code: "invalid_request",
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
          code: issue.code,
        })),
      },
      { status: 400 }
    );
  }

  console.error("[API Error]", error);

  return NextResponse.json(
    { error: "An unexpected error occurred", code: "internal_error" },
    { status: 500 }
  );
}
