import * as admin from "firebase-admin";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { ADMIN_EMAIL, DEFAULT_ORG_ID, db, requireAdmin, requireAuth, writeAudit } from "./context";
import { isAssignedRole, parseAssignableRole, parseRole, type StaffRole } from "./roles";

function normEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function identityFrom(request: CallableRequest): {
  displayName: string;
  photoUrl: string;
  provider: string;
} {
  const token = request.auth?.token as { name?: string; picture?: string; firebase?: { sign_in_provider?: string } } | undefined;
  return {
    displayName: String(token?.name ?? ""),
    photoUrl: String(token?.picture ?? ""),
    provider: String(token?.firebase?.sign_in_provider ?? ""),
  };
}

export const claimStaffAccess = onCall(async (request) => {
  const user = requireAuth(request);
  const email = normEmail(user.email);
  const orgId = DEFAULT_ORG_ID;
  const identity = identityFrom(request);
  const now = Date.now();
  const isOwner = email === ADMIN_EMAIL;

  const writeLogin = (role: StaffRole, extra: Record<string, unknown> = {}) =>
    db.collection("staffProfiles").doc(user.uid).set(
      {
        email,
        orgId,
        role,
        blocked: false,
        displayName: identity.displayName,
        photoUrl: identity.photoUrl,
        provider: identity.provider || "password",
        lastLoginMs: now,
        updatedAtMs: now,
        ...extra,
      },
      { merge: true },
    );

  if (isOwner) {
    await writeLogin("admin");
    return { staff: true, pending: false, role: "admin", orgId };
  }

  const existing = await db.collection("staffProfiles").doc(user.uid).get();
  if (existing.exists) {
    if (existing.get("blocked") === true) {
      throw new HttpsError("permission-denied", "This staff account is suspended.");
    }
    const role = parseRole(existing.get("role"));
    await writeLogin(role);
    const assigned = isAssignedRole(role);
    return { staff: assigned, pending: role === "pending", role, orgId: String(existing.get("orgId") ?? orgId) };
  }

  if (email) {
    const invite = await db.collection("staffInvites").doc(email).get();
    if (invite.exists) {
      const role = parseAssignableRole(invite.get("role"));
      await writeLogin(role, {
        invitedBy: invite.get("invitedBy") ?? null,
      });
      await invite.ref.delete();
      return { staff: true, pending: false, role, orgId };
    }
  }

  await writeLogin("pending");
  return { staff: false, pending: true, role: "pending", orgId };
});

export const listStaff = onCall(async (request) => {
  await requireAdmin(request);
  const [profiles, invites] = await Promise.all([
    db.collection("staffProfiles").get(),
    db.collection("staffInvites").get(),
  ]);
  const staff = profiles.docs
    .map((d) => ({
      uid: d.id,
      email: String(d.get("email") ?? ""),
      displayName: String(d.get("displayName") ?? ""),
      photoUrl: String(d.get("photoUrl") ?? ""),
      provider: String(d.get("provider") ?? ""),
      role: parseRole(d.get("role")),
      blocked: d.get("blocked") === true,
      orgId: String(d.get("orgId") ?? DEFAULT_ORG_ID),
      lastLoginMs: Number(d.get("lastLoginMs") ?? 0),
    }))
    .sort((a, b) => {
      if (a.role === "pending" && b.role !== "pending") return -1;
      if (b.role === "pending" && a.role !== "pending") return 1;
      return a.email.localeCompare(b.email);
    });
  return {
    staff,
    invites: invites.docs.map((d) => ({
      email: d.id,
      role: parseAssignableRole(d.get("role")),
      invitedBy: String(d.get("invitedBy") ?? ""),
      atMs: Number(d.get("atMs") ?? 0),
    })),
  };
});

export const inviteStaff = onCall(async (request) => {
  const adminUser = await requireAdmin(request);
  const email = normEmail(request.data?.email);
  const role = parseAssignableRole(request.data?.role);
  if (!email.includes("@")) throw new HttpsError("invalid-argument", "A valid email is required.");

  try {
    const existing = await admin.auth().getUserByEmail(email);
    await db.collection("staffProfiles").doc(existing.uid).set(
      {
        email,
        orgId: DEFAULT_ORG_ID,
        role,
        blocked: false,
        updatedAtMs: Date.now(),
        invitedBy: adminUser.email,
      },
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
  const role = parseAssignableRole(request.data?.role);
  if (!email.includes("@") || password.length < 6) {
    throw new HttpsError("invalid-argument", "Email and a password of at least 6 characters are required.");
  }
  let user: admin.auth.UserRecord;
  try {
    user = await admin.auth().createUser({ email, password, emailVerified: true });
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? String((e as { code?: string }).code) : "";
    if (code === "auth/email-already-exists") {
      const existing = await admin.auth().getUserByEmail(email);
      await db.collection("staffProfiles").doc(existing.uid).set(
        {
          email,
          orgId: DEFAULT_ORG_ID,
          role,
          blocked: false,
          updatedAtMs: Date.now(),
          invitedBy: adminUser.email,
        },
        { merge: true },
      );
      return { ok: true, uid: existing.uid };
    }
    throw e;
  }
  await db.collection("staffProfiles").doc(user.uid).set({
    email,
    orgId: DEFAULT_ORG_ID,
    role,
    blocked: false,
    invitedBy: adminUser.email,
    provider: "password",
    updatedAtMs: Date.now(),
  });
  await db.collection("staffInvites").doc(email).delete().catch(() => undefined);
  await writeAudit({ action: "create_staff", adminEmail: adminUser.email, targetUid: user.uid, detail: `${email} ${role}` });
  return { ok: true, uid: user.uid };
});

export const setStaffRole = onCall(async (request) => {
  const adminUser = await requireAdmin(request);
  const uid = String(request.data?.uid ?? "").trim();
  const role = parseAssignableRole(request.data?.role);
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
  return { ok: true, role };
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
