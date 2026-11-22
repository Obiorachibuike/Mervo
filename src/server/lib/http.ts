import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { PermissionError } from "@/server/auth/permissions";
import { NoTenantError, UnauthenticatedError } from "@/server/auth/session-core";
import { TenantIsolationError } from "@/server/db";
import { ValidationError } from "./validation";

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function jsonError(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

/** Maps domain errors to correct HTTP semantics without leaking internals. */
export function handleApiError(error: unknown) {
  if (error instanceof UnauthenticatedError) return jsonError("Authentication required", 401);
  if (error instanceof NoTenantError) return jsonError("No active workspace", 403);
  if (error instanceof PermissionError) return jsonError(error.message, 403, { permission: error.permission });
  if (error instanceof TenantIsolationError) return jsonError("Access denied", 403);
  if (error instanceof ValidationError) return jsonError(error.message, 422);
  if (error instanceof ZodError) {
    return jsonError(error.issues[0]?.message ?? "Invalid input", 422, { issues: error.issues });
  }
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (/duplicate key|unique constraint/i.test(message)) return jsonError("That record already exists", 409);
  console.error("API error:", error);
  return jsonError(process.env.NODE_ENV === "production" ? "Something went wrong" : message, 500);
}

export async function parseJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? "unknown";
}
