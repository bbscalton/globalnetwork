import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CURRENCY, DEFAULT_ORG_ID, DEFAULT_PLANS, db, requireOwner, sendToToken, writeAudit } from "./context";

export const ensureOrgDefaults = onCall(async (request) => {
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

export const registerOwnerDevice = onCall(async (request) => {
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

export const savePlan = onCall(async (request) => {
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

export const createCustomer = onCall(async (request) => {
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
  });
  await writeAudit({ action: "create_customer", adminEmail: owner.email, targetUid: ref.id, detail: name });
  return { customerId: ref.id };
});

export const extendSubscription = onCall(async (request) => {
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

export const suspendCustomer = onCall(async (request) => {
  const owner = await requireOwner(request);
  const customerId = String(request.data?.customerId ?? "");
  if (!customerId) throw new HttpsError("invalid-argument", "customerId required.");
  await db.collection("customers").doc(customerId).update({ status: "suspended", updatedAtMs: Date.now() });
  await writeAudit({ action: "suspend_customer", adminEmail: owner.email, targetUid: customerId });
  return { ok: true };
});

export const linkCustomerAccount = onCall(async (request) => {
  const uid = request.auth?.uid;
  const email = ((request.auth?.token?.email as string | undefined) ?? "").trim().toLowerCase();
  if (!uid || !email) throw new HttpsError("unauthenticated", "Sign in required.");
  const matches = await db.collection("customers").where("email", "==", email).limit(1).get();
  if (matches.empty) throw new HttpsError("not-found", "No customer record for this email.");
  await matches.docs[0].ref.update({ uid, lastSeenMs: Date.now() });
  return { customerId: matches.docs[0].id };
});

export const heartbeat = onCall(async (request) => {
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
