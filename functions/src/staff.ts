import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { ADMIN_EMAIL, DEFAULT_ORG_ID, db, requireAdmin, requireAuth, writeAudit } from "./context";

function normEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export const claimStaffAccess = onCall(async (request) => {
  const user = requireAuth(request);
  const email = normEmail(user.email);
  const orgId = DEFAULT_ORG_ID;
  const isOwner = email === ADMIN_EMAIL;
  if (isOwner) {
    await db.collection("staffProfiles").doc(user.uid).set(
      { email, orgId, role: "admin", blocked: false, updatedAtMs: Date.now() },
      { merge: true },
    );
    return { staff: true, role: "admin", orgId };
  }

  const existing = await db.collection("staffProfiles").doc(user.uid).get();
  if (existing.exists) {
    if (existing.get("blocked") === true) {
      throw new HttpsError("permission-denied", "This staff account is suspended.");
    }
    return { staff: true, role: String(existing.get("role") ?? "staff"), orgId: String(existing.get("orgId") ?? orgId) };
  }

  if (!email) return { staff: false, role: null, orgId };
  const invite = await db.collection("staffInvites").doc(email).get();
  if (!invite.exists) return { staff: false, role: null, orgId };

  const role = invite.get("role") === "admin" ? "admin" : "staff";
  await db.collection("staffProfiles").doc(user.uid).set({
    email,
    orgId: String(invite.get("orgId") ?? orgId),
    role,
    blocked: false,
    invitedBy: invite.get("invitedBy") ?? null,
    updatedAtMs: Date.now(),
  });
  await invite.ref.delete();
  return { staff: true, role, orgId };
});

export const listStaff = onCall(async (request) => {
  await requireAdmin(request);
  const [profiles, invites] = await Promise.all([
    db.collection("staffProfiles").get(),
    db.collection("staffInvites").get(),
  ]);
  return {
    staff: profiles.docs.map((d) => ({
      uid: d.id,
      email: String(d.get("email") ?? ""),
      role: String(d.get("role") ?? "staff"),
      blocked: d.get("blocked") === true,
      orgId: String(d.get("orgId") ?? DEFAULT_ORG_ID),
    })),
    invites: invites.docs.map((d) => ({
      email: d.id,
      role: String(d.get("role") ?? "staff"),
      invitedBy: String(d.get("invitedBy") ?? ""),
      atMs: Number(d.get("atMs") ?? 0),
    })),
  };
});

export const inviteStaff = onCall(async (request) => {
  const adminUser = await requireAdmin(request);
  const email = normEmail(request.data?.email);
  const role = request.data?.role === "admin" ? "admin" : "staff";
  if (!email.includes("@")) throw new HttpsError("invalid-argument", "A valid email is required.");

  try {
    const existing = await admin.auth().getUserByEmail(email);
    await db.collection("staffProfiles").doc(existing.uid).set(
      { email, orgId: DEFAULT_ORG_ID, role, blocked: false, updatedAtMs: Date.now(), invitedBy: adminUser.email },
      { merge: true },
    );
    await db.collection("staffInvites").doc(email).delete().catch(() => undefined);
    await writeAudit({ action: "invite_staff", adminEmail: adminUser.email, targetUid: existing.uid, detail: `${email} ${role}` });
    return { ok: true, status: "linked", uid: existing.uid };
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? String((e as { code?: string }).code) : "";
    if (code && code !== "auth/user-not-found") throw e;
  }

  await db.collection("staffInvites").doc(email).set({
    email,
    role,
    orgId: DEFAULT_ORG_ID,
    invitedBy: adminUser.email,
    atMs: Date.now(),
  });
  await writeAudit({ action: "invite_staff", adminEmail: adminUser.email, targetUid: email, detail: `${email} pending ${role}` });
  return { ok: true, status: "invited" };
});

export const createStaffAccount = onCall(async (request) => {
  const adminUser = await requireAdmin(request);
  const email = normEmail(request.data?.email);
  const password = String(request.data?.password ?? "");
  const role = request.data?.role === "admin" ? "admin" : "staff";
  if (!email.includes("@") || password.length < 6) {
    throw new HttpsError("invalid-argument", "Email and a password of at least 6 characters are required.");
  }
  let user: admin.auth.UserRecord
  try {
    user = await admin.auth().createUser({ email, password, emailVerified: true })
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? String((e as { code?: string }).code) : ""
    if (code === "auth/email-already-exists") {
      const existing = await admin.auth().getUserByEmail(email)
      await db.collection("staffProfiles").doc(existing.uid).set(
        { email, orgId: DEFAULT_ORG_ID, role, blocked: false, updatedAtMs: Date.now(), invitedBy: adminUser.email },
        { merge: true },
      )
      return { ok: true, uid: existing.uid }
    }
    throw e
  };
  await db.collection("staffProfiles").doc(user.uid).set({
    email,
    orgId: DEFAULT_ORG_ID,
    role,
    blocked: false,
    invitedBy: adminUser.email,
    updatedAtMs: Date.now(),
  });
  await db.collection("staffInvites").doc(email).delete().catch(() => undefined);
  await writeAudit({ action: "create_staff", adminEmail: adminUser.email, targetUid: user.uid, detail: email });
  return { ok: true, uid: user.uid };
});

export const setStaffRole = onCall(async (request) => {
  const adminUser = await requireAdmin(request);
  const uid = String(request.data?.uid ?? "").trim();
  const role = request.data?.role === "admin" ? "admin" : "staff";
  const blocked = request.data?.blocked === true;
  if (!uid) throw new HttpsError("invalid-argument", "Staff uid is required.");
  const ref = db.collection("staffProfiles").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Staff profile not found.");
  await ref.set({ role, blocked, updatedAtMs: Date.now() }, { merge: true });
  await writeAudit({
    action: "set_staff_role",
    adminEmail: adminUser.email,
    targetUid: uid,
    detail: `${role}${blocked ? " blocked" : ""}`,
  });
  return { ok: true };
});

export const removeStaff = onCall(async (request) => {
  const adminUser = await requireAdmin(request);
  const uid = String(request.data?.uid ?? "").trim();
  const email = normEmail(request.data?.email);
  if (uid) await db.collection("staffProfiles").doc(uid).delete();
  if (email) await db.collection("staffInvites").doc(email).delete().catch(() => undefined);
  await writeAudit({ action: "remove_staff", adminEmail: adminUser.email, targetUid: uid || email, detail: email });
  return { ok: true };
});
