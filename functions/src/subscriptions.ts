import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { CALLABLE, CURRENCY, DEFAULT_ORG_ID, DEFAULT_PLANS, db, ownerFcmToken, requireOwner, sendToToken, writeAudit } from "./context";

export const ensureOrgDefaults = onCall(CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const orgId = String(request.data?.orgId ?? DEFAULT_ORG_ID);
  const orgRef = db.collection("orgs").doc(orgId);
  await orgRef.set(
    {
      name: "GlobalNetwork",
      currency: CURRENCY,
      ownerEmail: owner.email,
      ownerUid: owner.uid,
      updatedAtMs: Date.now(),
      updatedBy: owner.email,
    },
    { merge: true },
  );

  for (const plan of DEFAULT_PLANS) {
    const ref = db.collection("plans").doc(plan.id);
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set({ ...plan, orgId, createdAtMs: Date.now() });
    } else {
      await ref.set({ currency: CURRENCY }, { merge: true });
    }
  }

  await writeAudit({
    action: "ensure_org_defaults",
    adminEmail: owner.email,
    targetUid: orgId,
  });
  return { ok: true, orgId };
});

export const registerOwnerDevice = onCall(CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const token = String(request.data?.fcmToken ?? "").trim();
  const orgId = String(request.data?.orgId ?? DEFAULT_ORG_ID);
  await db.collection("orgs").doc(orgId).set(
    {
      ownerEmail: owner.email,
      ownerUid: owner.uid,
      ownerFcmToken: token || null,
      ownerLastSeenMs: Date.now(),
    },
    { merge: true },
  );
  return { ok: true };
});

export const savePlan = onCall(CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const name = String(request.data?.name ?? "").trim();
  const days = Number(request.data?.days ?? 0);
  const feeAmount = Number(request.data?.feeAmount ?? 0);
  if (!name || days < 1 || feeAmount < 0) {
    throw new HttpsError("invalid-argument", "Plan name, days, and fee are required.");
  }
  const id = String(request.data?.id ?? "").trim() || db.collection("plans").doc().id;
  await db
    .collection("plans")
    .doc(id)
    .set(
      {
        name,
        days,
        feeAmount,
        currency: String(request.data?.currency ?? CURRENCY),
        active: request.data?.active !== false,
        orgId: DEFAULT_ORG_ID,
        updatedAtMs: Date.now(),
        updatedBy: owner.email,
      },
      { merge: true },
    );
  await writeAudit({ action: "save_plan", adminEmail: owner.email, targetUid: id, detail: name });
  return { ok: true, id };
});

export const createCustomer = onCall(CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const name = String(request.data?.name ?? "").trim();
  if (!name) throw new HttpsError("invalid-argument", "Name is required.");
  const planId = String(request.data?.planId ?? "");
  let planName = "";
  let planDays = 30;
  let feeAmount = 0;
  if (planId) {
    const plan = await db.collection("plans").doc(planId).get();
    if (plan.exists) {
      planName = String(plan.get("name") ?? "");
      planDays = Number(plan.get("days") ?? 30);
      feeAmount = Number(plan.get("feeAmount") ?? 0);
    }
  }
  const ref = db.collection("customers").doc();
  await ref.set({
    orgId: String(request.data?.orgId ?? DEFAULT_ORG_ID),
    name,
    phone: String(request.data?.phone ?? "").trim(),
    email: String(request.data?.email ?? "").trim().toLowerCase(),
    address: String(request.data?.address ?? "").trim(),
    status: "expired",
    planId,
    planName,
    planDays,
    feeAmount,
    paidAmount: 0,
    balanceDue: feeAmount,
    paidUntilMs: null,
    graceUntilMs: null,
    lastSeenMs: 0,
    unreadStaff: 0,
    createdAtMs: Date.now(),
    createdBy: owner.uid,
    uid: null,
    approvalStatus: "approved",
  });
  await writeAudit({ action: "create_customer", adminEmail: owner.email, targetUid: ref.id, detail: name });
  return { customerId: ref.id };
});

export const extendSubscription = onCall(CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const customerId = String(request.data?.customerId ?? "");
  const days = Math.floor(Number(request.data?.days ?? 0));
  const amountPaid = Number(request.data?.amountPaid ?? 0);
  const note = String(request.data?.note ?? "").trim();
  if (!customerId || days < 1) {
    throw new HttpsError("invalid-argument", "customerId and days (>= 1) are required.");
  }
  if (amountPaid < 0) throw new HttpsError("invalid-argument", "amountPaid cannot be negative.");

  const ref = db.collection("customers").doc(customerId);
  const now = Date.now();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Customer not found.");
    const feeAmount = Number(snap.get("feeAmount") ?? 0);
    const prevPaid = Number(snap.get("paidAmount") ?? 0);
    const prevUntil = Number(snap.get("paidUntilMs") ?? 0);
    const statusNow = String(snap.get("status") ?? "expired");
    const base = statusNow === "active" || statusNow === "grace" ? Math.max(prevUntil, now) : now;
    const paidUntilMs = base + days * 24 * 60 * 60 * 1000;
    const paidAmount = prevPaid + amountPaid;
    const cycleFee = feeAmount > 0 ? feeAmount : amountPaid;
    const partial = feeAmount > 0 && amountPaid < feeAmount;
    const balanceDue = Math.max(0, cycleFee - amountPaid);
    const status = partial ? "grace" : "active";
    const graceUntilMs = partial ? paidUntilMs : null;
    tx.update(ref, {
      paidUntilMs,
      paidAmount,
      balanceDue,
      status,
      graceUntilMs,
      lastPaymentAmount: amountPaid,
      lastPaymentMs: now,
      approvalStatus: "approved",
      approvedAtMs: now,
    });
    const payRef = ref.collection("payments").doc();
    tx.set(payRef, {
      amount: amountPaid,
      kind: partial ? (amountPaid === 0 ? "grace" : "partial") : "full",
      daysGranted: days,
      note,
      atMs: now,
      byUid: owner.uid,
    });
    return { paidUntilMs, status, balanceDue };
  });

  await writeAudit({
    action: "extend_subscription",
    adminEmail: owner.email,
    targetUid: customerId,
    detail: `${days}d paid ${amountPaid} note=${note}`,
  });

  const customer = await ref.get();
  await sendToToken(
    customer.get("fcmToken") as string | undefined,
    "GlobalNetwork service updated",
    `Your internet service is extended to ${new Date(result.paidUntilMs).toLocaleDateString()}.`,
    { type: "subscription", customerId },
  );

  return result;
});

export const suspendCustomer = onCall(CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const customerId = String(request.data?.customerId ?? "");
  if (!customerId) throw new HttpsError("invalid-argument", "customerId required.");
  await db.collection("customers").doc(customerId).update({ status: "suspended", updatedAtMs: Date.now() });
  await writeAudit({ action: "suspend_customer", adminEmail: owner.email, targetUid: customerId });
  return { ok: true };
});

export const linkCustomerAccount = onCall(CALLABLE, async (request) => {
  try {
    const uid = request.auth?.uid;
    const claims = request.auth?.token as Record<string, unknown> | undefined;
    const email = String(claims?.email ?? "").trim().toLowerCase();
    if (!uid || !email) {
      throw new HttpsError("unauthenticated", "Sign in with a Google or email account that has an email address.");
    }
    const matches = await db.collection("customers").where("email", "==", email).limit(1).get();
    if (!matches.empty) {
      const snap = matches.docs[0];
      const current = String(snap.get("approvalStatus") ?? "");
      const patch: Record<string, unknown> = { uid, lastSeenMs: Date.now() };
      if (!current) {
        const createdBy = String(snap.get("createdBy") ?? "");
        const hasKyc = Boolean(snap.get("idPhotoUrl") || snap.get("kycSubmittedAtMs"));
        patch.approvalStatus = createdBy === uid && !hasKyc ? "none" : "approved";
      }
      await snap.ref.update(patch);
      return { customerId: snap.id };
    }
    const displayName = String(claims?.name ?? "").trim() || email.split("@")[0];
    const ref = db.collection("customers").doc();
    await ref.set({
      orgId: DEFAULT_ORG_ID,
      name: displayName,
      phone: "",
      email,
      address: "",
      status: "expired",
      planId: "",
      planName: "",
      planDays: 0,
      feeAmount: 0,
      paidAmount: 0,
      balanceDue: 0,
      paidUntilMs: null,
      graceUntilMs: null,
      lastSeenMs: Date.now(),
      unreadStaff: 0,
      createdAtMs: Date.now(),
      createdBy: uid,
      uid,
      approvalStatus: "none",
    });
    return { customerId: ref.id };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error("linkCustomerAccount failed", error);
    throw new HttpsError("unavailable", "Could not open your GlobalNetwork account. Try again.");
  }
});

export const heartbeat = onCall(CALLABLE, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const customerId = String(request.data?.customerId ?? uid);
  const ref = db.collection("customers").doc(customerId);
  const snap = await ref.get();
  if (!snap.exists || (snap.get("uid") !== uid && snap.id !== uid)) {
    throw new HttpsError("permission-denied", "Not your customer record.");
  }
  await ref.update({ lastSeenMs: Date.now(), fcmToken: request.data?.fcmToken ?? snap.get("fcmToken") ?? null });
  return { ok: true };
});

export const submitCustomerApplication = onCall(CALLABLE, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const customerId = String(request.data?.customerId ?? "").trim();
  const name = String(request.data?.name ?? "").trim();
  const phone = String(request.data?.phone ?? "").trim();
  const address = String(request.data?.address ?? "").trim();
  const idPhotoUrl = String(request.data?.idPhotoUrl ?? "").trim();
  const billingPhotoUrl = String(request.data?.billingPhotoUrl ?? "").trim();
  if (!customerId || !name || !phone || !address || !idPhotoUrl || !billingPhotoUrl) {
    throw new HttpsError("invalid-argument", "Name, phone, address, ID photo, and billing-address photo are required.");
  }
  const ref = db.collection("customers").doc(customerId);
  const snap = await ref.get();
  if (!snap.exists || snap.get("uid") !== uid) {
    throw new HttpsError("permission-denied", "Not your customer record.");
  }
  if (String(snap.get("approvalStatus") ?? "") === "approved") {
    throw new HttpsError("failed-precondition", "This account is already approved.");
  }
  await ref.update({
    name,
    phone,
    address,
    idPhotoUrl,
    billingPhotoUrl,
    approvalStatus: "pending",
    kycSubmittedAtMs: Date.now(),
    rejectionReason: admin.firestore.FieldValue.delete(),
    lastSeenMs: Date.now(),
  });
  await sendToToken(
    await ownerFcmToken(),
    "New GlobalNetwork application",
    `${name} submitted ID and billing photos for approval.`,
    { type: "application", customerId },
  );
  return { ok: true, customerId };
});

export const reviewCustomerApplication = onCall(CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const customerId = String(request.data?.customerId ?? "").trim();
  const decision = String(request.data?.decision ?? "").trim().toLowerCase();
  const reason = String(request.data?.reason ?? "").trim();
  if (!customerId || (decision !== "approved" && decision !== "rejected")) {
    throw new HttpsError("invalid-argument", "customerId and decision (approved|rejected) are required.");
  }
  if (decision === "rejected" && !reason) {
    throw new HttpsError("invalid-argument", "Say why the application was rejected.");
  }
  const ref = db.collection("customers").doc(customerId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Customer not found.");
  const now = Date.now();
  if (decision === "approved") {
    await ref.update({
      approvalStatus: "approved",
      approvedAtMs: now,
      approvedBy: owner.email,
      rejectionReason: admin.firestore.FieldValue.delete(),
    });
    await sendToToken(
      snap.get("fcmToken") as string | undefined,
      "GlobalNetwork approved you",
      "Your application is approved. GlobalNetwork will set your package and days from payment received.",
      { type: "application", customerId },
    );
  } else {
    await ref.update({
      approvalStatus: "rejected",
      rejectedAtMs: now,
      rejectedBy: owner.email,
      rejectionReason: reason,
    });
    await sendToToken(
      snap.get("fcmToken") as string | undefined,
      "Application needs changes",
      reason,
      { type: "application", customerId },
    );
  }
  await writeAudit({
    action: `application_${decision}`,
    adminEmail: owner.email,
    targetUid: customerId,
    detail: reason || "approved",
  });
  return { ok: true, decision };
});
