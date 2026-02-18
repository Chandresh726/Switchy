import { NextResponse } from "next/server";

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
  constructor(message: string) {
    super("validation_error", message, 400);
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

  console.error("[API Error]", error);

  return NextResponse.json(
    { error: "An unexpected error occurred", code: "internal_error" },
    { status: 500 }
  );
}
