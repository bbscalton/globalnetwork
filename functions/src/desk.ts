import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import {
  ADMIN_EMAIL,
  CALLABLE,
  db,
  isFounderEmail,
  requireAuth,
  requireOwner,
  sendToOwners,
  setOwnerClaim,
  writeAudit,
} from "./context";

type DeskRole = "owner" | "pending" | "rejected";

function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

async function memberByEmail(email: string) {
  const matches = await db.collection("deskMembers").where("email", "==", email).limit(1).get();
  return matches.empty ? null : matches.docs[0];
}

async function writeMember(
  uid: string,
  patch: Record<string, unknown>,
): Promise<{ role: DeskRole; email: string; name: string; isPrimary: boolean }> {
  const ref = db.collection("deskMembers").doc(uid);
  await ref.set({ uid, ...patch, lastSeenMs: Date.now() }, { merge: true });
  const snap = await ref.get();
  return {
    role: (String(snap.get("role") ?? "pending") as DeskRole) || "pending",
    email: String(snap.get("email") ?? ""),
    name: String(snap.get("name") ?? ""),
    isPrimary: snap.get("isPrimary") === true,
  };
}

async function grantOwner(uid: string, email: string, name: string, approvedBy: string): Promise<void> {
  await db.collection("deskMembers").doc(uid).set(
    {
      uid,
      email,
      name,
      role: "owner",
      isPrimary: isFounderEmail(email),
      approvedAtMs: Date.now(),
      approvedBy,
      rejectedReason: "",
      lastSeenMs: Date.now(),
    },
    { merge: true },
  );
  await setOwnerClaim(uid, true);
  await db.collection("deskInvites").doc(email).delete().catch(() => undefined);
}

export const linkDeskAccount = onCall(CALLABLE, async (request) => {
  try {
    const user = requireAuth(request);
    const claims = request.auth?.token as Record<string, unknown> | undefined;
    const email = normalizeEmail(claims?.email ?? user.email);
    const name = String(claims?.name ?? "").trim() || email.split("@")[0];
    if (!email) {
      throw new HttpsError("unauthenticated", "Sign in with a Google or email account that has an email address.");
    }

    const existing = (await memberByEmail(email)) ?? (await db.collection("deskMembers").doc(user.uid).get());
    if (existing && existing.exists && existing.id !== user.uid) {
      const data = existing.data() ?? {};
      await db.collection("deskMembers").doc(user.uid).set(
        {
          ...data,
          uid: user.uid,
          email,
          name: name || String(data.name ?? ""),
          lastSeenMs: Date.now(),
        },
        { merge: true },
      );
      await existing.ref.delete();
    }

    if (isFounderEmail(email)) {
      await grantOwner(user.uid, email, name, email);
      return { role: "owner" as const, email, name, isPrimary: true };
    }

    const mine = await db.collection("deskMembers").doc(user.uid).get();
    const currentRole = String(mine.get("role") ?? "");
    if (currentRole === "owner") {
      await writeMember(user.uid, { email, name, role: "owner" });
      await setOwnerClaim(user.uid, true);
      return { role: "owner" as const, email, name, isPrimary: mine.get("isPrimary") === true };
    }
    if (currentRole === "rejected") {
      return {
        role: "rejected" as const,
        email,
        name,
        reason: String(mine.get("rejectedReason") ?? "Desk access was not approved."),
      };
    }

    const invite = await db.collection("deskInvites").doc(email).get();
    if (invite.exists && String(invite.get("role") ?? "owner") === "owner") {
      const invitedBy = String(invite.get("invitedBy") ?? "owner");
      await grantOwner(user.uid, email, name, invitedBy);
      await writeAudit({ action: "desk_invite_accepted", adminEmail: invitedBy, targetUid: user.uid, detail: email });
      return { role: "owner" as const, email, name, isPrimary: false };
    }

    const created = !mine.exists || currentRole !== "pending";
    await writeMember(user.uid, {
      email,
      name,
      role: "pending",
      isPrimary: false,
      requestedAtMs: mine.get("requestedAtMs") ?? Date.now(),
    });
    if (created) {
      await sendToOwners("Desk access request", `${name} (${email}) asked to join the owner desk.`, {
        type: "desk",
        uid: user.uid,
      });
    }
    return { role: "pending" as const, email, name };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error("linkDeskAccount failed", error);
    throw new HttpsError("unavailable", "Could not open your desk account. Try again.");
  }
});

export const inviteDeskOwner = onCall(CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const email = normalizeEmail(request.data?.email);
  const name = String(request.data?.name ?? "").trim();
  if (!email || !email.includes("@")) throw new HttpsError("invalid-argument", "A valid email is required.");
  if (isFounderEmail(email)) throw new HttpsError("already-exists", "That email is already the founding owner.");

  const existing = await memberByEmail(email);
  if (existing && String(existing.get("role") ?? "") === "owner") {
    throw new HttpsError("already-exists", "That person is already an owner.");
  }
  if (existing && String(existing.get("role") ?? "") === "pending") {
    await grantOwner(existing.id, email, String(existing.get("name") ?? name), owner.email);
    await writeAudit({ action: "desk_member_approved", adminEmail: owner.email, targetUid: existing.id, detail: email });
    return { ok: true, status: "approved_existing", email };
  }

  await db.collection("deskInvites").doc(email).set({
    email,
    name,
    role: "owner",
    status: "open",
    invitedBy: owner.email,
    invitedAtMs: Date.now(),
  });
  await writeAudit({ action: "desk_owner_invited", adminEmail: owner.email, targetUid: email, detail: "owner" });
  return { ok: true, status: "invited", email };
});

export const reviewDeskMember = onCall(CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const uid = String(request.data?.uid ?? "").trim();
  const decision = String(request.data?.decision ?? "").trim().toLowerCase();
  const reason = String(request.data?.reason ?? "").trim();
  if (!uid || (decision !== "approved" && decision !== "rejected")) {
    throw new HttpsError("invalid-argument", "uid and decision (approved|rejected) are required.");
  }
  const ref = db.collection("deskMembers").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "No desk request for that account.");
  const email = normalizeEmail(snap.get("email"));
  const name = String(snap.get("name") ?? email);
  if (isFounderEmail(email)) throw new HttpsError("failed-precondition", "The founding owner cannot be changed here.");

  if (decision === "approved") {
    await grantOwner(uid, email, name, owner.email);
    await writeAudit({ action: "desk_member_approved", adminEmail: owner.email, targetUid: uid, detail: email });
    return { ok: true, decision };
  }

  if (!reason) throw new HttpsError("invalid-argument", "Say why desk access was rejected.");
  await ref.set(
    {
      role: "rejected",
      rejectedReason: reason,
      rejectedAtMs: Date.now(),
      rejectedBy: owner.email,
    },
    { merge: true },
  );
  await setOwnerClaim(uid, false);
  await writeAudit({ action: "desk_member_rejected", adminEmail: owner.email, targetUid: uid, detail: reason });
  return { ok: true, decision };
});

export const removeDeskOwner = onCall(CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const uid = String(request.data?.uid ?? "").trim();
  if (!uid) throw new HttpsError("invalid-argument", "uid is required.");
  if (uid === owner.uid) throw new HttpsError("failed-precondition", "You cannot remove your own owner access.");
  const ref = db.collection("deskMembers").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Owner not found.");
  const email = normalizeEmail(snap.get("email"));
  if (isFounderEmail(email) || email === ADMIN_EMAIL) {
    throw new HttpsError("failed-precondition", "The founding owner cannot be removed.");
  }
  await ref.set(
    {
      role: "rejected",
      rejectedReason: "Removed from the owner desk.",
      rejectedAtMs: Date.now(),
      rejectedBy: owner.email,
    },
    { merge: true },
  );
  await db.collection("deskInvites").doc(email).delete().catch(() => undefined);
  await setOwnerClaim(uid, false);
  await writeAudit({ action: "desk_owner_removed", adminEmail: owner.email, targetUid: uid, detail: email });
  return { ok: true };
});

export const revokeDeskInvite = onCall(CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const email = normalizeEmail(request.data?.email);
  if (!email) throw new HttpsError("invalid-argument", "email is required.");
  await db.collection("deskInvites").doc(email).delete();
  await writeAudit({ action: "desk_invite_revoked", adminEmail: owner.email, targetUid: email });
  return { ok: true };
});
