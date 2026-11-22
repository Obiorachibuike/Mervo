"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db";
import { getAuth, logAudit } from "@/server/auth/session";
import { provisionBusiness } from "@/server/services/tenants";
import { failure, type ActionResult } from "./ctx";
import { ValidationError } from "@/server/lib/validation";

export async function createWorkspaceAction(formData: FormData): Promise<ActionResult> {
  try {
    const auth = await getAuth();
    if (!auth) redirect("/login");
    const businessName = String(formData.get("businessName") ?? "").trim();
    if (businessName.length < 2) throw new ValidationError("Enter your business name");
    const existing = auth.memberships.length;
    if (existing > 5) throw new ValidationError("You have reached the maximum number of workspaces for one account");
    const db = await getDb();
    const result = await provisionBusiness(db, {
      ownerUserId: auth.user.id,
      businessName,
      industry: String(formData.get("industry") ?? "retail"),
      currency: (String(formData.get("currency") ?? "NGN") as "NGN" | "USD" | "EUR" | "GBP"),
      country: String(formData.get("country") ?? "NG"),
      planCode: String(formData.get("planCode") ?? "free"),
      withRestaurant: formData.get("withRestaurant") === "on",
      seedCatalogue: formData.get("seedCatalogue") === "on",
    });
    await logAudit({
      tenantId: result.tenantId,
      actorId: auth.user.id,
      actorEmail: auth.user.email,
      action: "tenant.provision",
      entity: "tenant",
      entityId: result.tenantId,
      metadata: { businessName, planCode: String(formData.get("planCode") ?? "free") },
    });
    revalidatePath("/dashboard");
    return { ok: true, message: `${businessName} is ready` };
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    return failure(error);
  }
}
