// POST /functions/v1/admin-users  { action: "suspend"|"reactivate"|"password_reset", userId, reason? }
// Account actions that also need Supabase Auth (blocking sign-in, reset emails).
// Permission checks run in the database as the calling admin (RLS + RPC checks).
// Admins never see or set passwords: a reset link is emailed to the student.
import { handler, HttpError, isUuid, json, readJson } from "../_shared/http.ts";
import { adminClient, env, requireUser } from "../_shared/supabase.ts";

Deno.serve(handler(Deno.env.get("ALLOWED_ORIGINS") ?? "*", async (req) => {
  const { user, userClient } = await requireUser(req);
  const admin = adminClient();
  const body = await readJson<{ action?: string; userId?: string; reason?: string }>(req, 4096);
  if (!isUuid(body.userId)) throw new HttpError(400, "invalid_user");

  if (body.action === "suspend" || body.action === "reactivate") {
    // The RPC enforces users.manage, requires a reason and writes the audit log.
    const { error } = await userClient.rpc("admin_set_user_status", {
      p_user: body.userId, p_status: body.action === "suspend" ? "suspended" : "active", p_reason: body.reason ?? "",
    });
    if (error) throw new HttpError(error.code === "42501" ? 403 : 400, "status_change_failed", error.message);
    // Block (or restore) sign-in at the Auth layer too; existing sessions expire with their JWT.
    const { error: banErr } = await admin.auth.admin.updateUserById(body.userId, {
      ban_duration: body.action === "suspend" ? "876000h" : "none",
    });
    if (banErr) throw new HttpError(500, "auth_update_failed", banErr.message);
    return json({ ok: true });
  }

  if (body.action === "password_reset") {
    const { data: allowed } = await userClient.rpc("has_permission", { perm: "users.manage" });
    if (!allowed) throw new HttpError(403, "permission_denied");
    const { data: profile } = await admin.from("profiles").select("email").eq("id", body.userId).single();
    if (!profile?.email) throw new HttpError(404, "user_not_found");
    const { error } = await admin.auth.resetPasswordForEmail(profile.email, {
      redirectTo: `${env("APP_URL").replace(/\/$/, "")}/reset-password`,
    });
    if (error) throw new HttpError(500, "reset_failed", error.message);
    await admin.from("audit_logs").insert({ actor_id: user.id, action: "PASSWORD_RESET_SENT", entity_type: "profiles", entity_id: body.userId });
    return json({ ok: true });
  }

  throw new HttpError(400, "invalid_action");
}));
