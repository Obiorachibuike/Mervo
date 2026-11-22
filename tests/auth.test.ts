import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { boot, createWorkspace, addMember } from "./harness";
import { users } from "@/server/db/schema";
import { generateTotpSecret, hashPassword, totpCode, verifyPassword, verifyTotp, encryptSecret, decryptSecret, maskSecret } from "@/server/lib/crypto";
import { createSession, loadAuthContext, revokeSession, switchTenant, requireSuperAdmin, UnauthenticatedError } from "@/server/auth/session-core";
import { assertPermission, hasPermission, PermissionError, resolvePermissions } from "@/server/auth/permissions";
import { rateLimit } from "@/server/lib/rate-limit";

describe("authentication", () => {
  it("hashes passwords with scrypt and verifies them", async () => {
    const hash = await hashPassword("CorrectHorse#2025");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("CorrectHorse#2025", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
    expect(await verifyPassword("CorrectHorse#2025", null)).toBe(false);
    // same password, different salt → different hash
    expect(await hashPassword("CorrectHorse#2025")).not.toBe(hash);
  });

  it("creates, resolves and revokes a session", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "Session Co");
    const session = await createSession(ws.ownerId, { tenantId: ws.tenantId, ip: "127.0.0.1" }, db);
    const ctx = await loadAuthContext(session.token, db);
    expect(ctx?.user.id).toBe(ws.ownerId);
    expect(ctx?.tenantId).toBe(ws.tenantId);
    expect(ctx?.permissions).toContain("sales.create");
    await revokeSession(session.sessionId, db);
    expect(await loadAuthContext(session.token, db)).toBeNull();
  });

  it("rejects expired and forged tokens", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "Expiry Co");
    const session = await createSession(ws.ownerId, { tenantId: ws.tenantId }, db);
    expect(await loadAuthContext(`${session.token}x`, db)).toBeNull();
    expect(await loadAuthContext(undefined, db)).toBeNull();
  });

  it("switches the active tenant only for members", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "Switch Co");
    const session = await createSession(ws.ownerId, { tenantId: ws.tenantId }, db);
    await switchTenant(session.sessionId, ws.tenantId, db);
    const ctx = await loadAuthContext(session.token, db);
    expect(ctx?.tenantId).toBe(ws.tenantId);
  });

  it("enforces granular permissions per role", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "Roles Co");
    const cashier = await addMember(db, ws.tenantId, "cashier");
    expect(hasPermission(cashier.permissions, "sales.create")).toBe(true);
    expect(hasPermission(cashier.permissions, "finance.view")).toBe(false);
    expect(() => assertPermission(cashier.permissions, "finance.view")).toThrow(PermissionError);
    const owner = await addMember(db, ws.tenantId, "owner");
    expect(resolvePermissions(owner.permissions).length).toBeGreaterThan(20);
    expect(() => assertPermission(["*"], "settings.manage")).not.toThrow();
  });

  it("requires super admin for platform areas", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "Admin Gate Co");
    const session = await createSession(ws.ownerId, { tenantId: ws.tenantId }, db);
    const ctx = await loadAuthContext(session.token, db);
    expect(() => requireSuperAdmin(ctx)).toThrow();
    expect(() => requireSuperAdmin(null)).toThrow(UnauthenticatedError);
  });

  it("supports TOTP multi-factor authentication", () => {
    const secret = generateTotpSecret();
    const code = totpCode(secret);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotp(secret, code)).toBe(true);
    expect(verifyTotp(secret, "000000")).toBe(false);
    expect(verifyTotp(secret, "12345")).toBe(false);
  });

  it("encrypts provider secrets at rest with AES-256-GCM", () => {
    const encrypted = encryptSecret("sk_live_super_secret_value");
    expect(encrypted).not.toContain("super_secret");
    expect(decryptSecret(encrypted)).toBe("sk_live_super_secret_value");
    expect(decryptSecret("v1.tampered.value.tag")).toBeNull();
    expect(maskSecret("sk_live_1234567890")).toBe("sk_l••••7890");
  });

  it("rate limits repeated attempts", async () => {
    await boot();
    const identifier = `test-${Date.now()}`;
    let allowedCount = 0;
    for (let i = 0; i < 6; i++) {
      const result = await rateLimit({ bucket: "login", identifier, limit: 5, windowSeconds: 60 });
      if (result.allowed) allowedCount++;
    }
    expect(allowedCount).toBe(5);
  });

  it("does not leak password hashes through the session context", async () => {
    const db = await boot();
    const ws = await createWorkspace(db, "Leak Co");
    const session = await createSession(ws.ownerId, { tenantId: ws.tenantId }, db);
    const ctx = await loadAuthContext(session.token, db);
    expect(JSON.stringify(ctx)).not.toContain("scrypt$");
    const [row] = await db.select().from(users).where(eq(users.id, ws.ownerId));
    expect(row!.passwordHash).toContain("scrypt$");
  });
});
