import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { CALLABLE, CURRENCY, DAY_EXTENSION_RATE_XCD, DAY_MS, DEFAULT_ORG_ID, DEFAULT_PLANS, FieldValue, db, requireManager, requireOwner, requirePosStaff, sendToOwners, sendToToken, writeAudit, type StaffSession } from "./context";
import { customerByUid, customersWithEmail, normalizeEmail, pickCustomerKeeper } from "./customerRecords";

const COORD = /^\s*(-?\d{1,2}\.\d+)\s*[ ,]\s*(-?\d{1,3}\.\d+)\s*$/;
const OWNER_DESK_OUTLET = { locationId: "owner-desk", locationName: "Owner desk" };

function collectionSite(requestData: unknown, staff: StaffSession): { locationId: string; locationName: string } {
  const rec = requestData && typeof requestData === "object" ? (requestData as Record<string, unknown>) : {};
  let locationId = String(rec.locationId ?? "").trim().slice(0, 80);
  let locationName = String(rec.locationName ?? "").trim().slice(0, 80);
  if (!locationId && !locationName) {
    locationId = OWNER_DESK_OUTLET.locationId;
    locationName = OWNER_DESK_OUTLET.locationName;
  } else if (!locationId) {
    locationId = locationName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || OWNER_DESK_OUTLET.locationId;
  } else if (!locationName) {
    locationName = locationId;
  }
  if (staff.role === "cashier" && staff.outletIds.length > 0 && !staff.outletIds.includes(locationId)) {
    throw new HttpsError("permission-denied", "This cashier can only collect at assigned outlets.");
  }
  return { locationId, locationName };
}

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
  await db.collection("deskMembers").doc(owner.uid).set(
    {
      uid: owner.uid,
      email: owner.email,
      fcmToken: token || null,
      lastSeenMs: Date.now(),
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
  const owner = await requireManager(request);
  const name = String(request.data?.name ?? "").trim();
  if (!name) throw new HttpsError("invalid-argument", "Name is required.");
  const email = normalizeEmail(request.data?.email);
  const phone = String(request.data?.phone ?? "").trim();
  const address = String(request.data?.address ?? "").trim();
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

  if (email) {
    const matches = await customersWithEmail(email);
    if (matches.length) {
      const keeper = pickCustomerKeeper(matches);
      const patch: Record<string, unknown> = { email, updatedAtMs: Date.now() };
      if (!String(keeper.get("name") ?? "").trim()) patch.name = name;
      if (!String(keeper.get("phone") ?? "").trim() && phone) patch.phone = phone;
      if (!String(keeper.get("address") ?? "").trim() && address) patch.address = address;
      if (!String(keeper.get("planId") ?? "").trim() && planId) {
        patch.planId = planId;
        patch.planName = planName;
        patch.planDays = planDays;
        patch.feeAmount = feeAmount;
        if (Number(keeper.get("balanceDue") ?? 0) === 0 && Number(keeper.get("paidAmount") ?? 0) === 0) {
          patch.balanceDue = feeAmount;
        }
      }
      await keeper.ref.update(patch);
      await writeAudit({
        action: "create_customer_attached",
        adminEmail: owner.email,
        targetUid: keeper.id,
        detail: email,
      });
      return { customerId: keeper.id, existing: true };
    }
  }

  const ref = db.collection("customers").doc();
  await ref.set({
    orgId: String(request.data?.orgId ?? DEFAULT_ORG_ID),
    name,
    phone,
    email,
    address,
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
  return { customerId: ref.id, existing: false };
});

export const extendSubscription = onCall(CALLABLE, async (request) => {
  const owner = await requirePosStaff(request);
  const customerId = String(request.data?.customerId ?? "");
  const days = Math.floor(Number(request.data?.days ?? 0));
  const amountPaid = Number(request.data?.amountPaid ?? 0);
  const note = String(request.data?.note ?? "").trim();
  const site = collectionSite(request.data, owner);
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
    const paidUntilMs = base + days * DAY_MS;
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
      collectedByUid: owner.uid,
      collectedByEmail: owner.email,
      locationId: site.locationId,
      locationName: site.locationName,
      channel: site.locationId === OWNER_DESK_OUTLET.locationId ? "desk" : "pos",
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

export const grantDayExtension = onCall(CALLABLE, async (request) => {
  const owner = await requireManager(request);
  const customerId = String(request.data?.customerId ?? "");
  const days = Math.floor(Number(request.data?.days ?? 0));
  const note = String(request.data?.note ?? "").trim();
  const site = collectionSite(request.data, owner);
  if (!customerId || !Number.isFinite(days) || days < 1) {
    throw new HttpsError("invalid-argument", "customerId and days (>= 1) are required.");
  }

  const charge = days * DAY_EXTENSION_RATE_XCD;
  const ledgerNote =
    note || `${days}-day extension @ EC$${DAY_EXTENSION_RATE_XCD}/day · EC$${charge} added to balance`;

  const ref = db.collection("customers").doc(customerId);
  const now = Date.now();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Customer not found.");
    const prevUntil = Number(snap.get("paidUntilMs") ?? 0);
    const statusNow = String(snap.get("status") ?? "expired");
    const prevBalance = Number(snap.get("balanceDue") ?? 0);
    const base = statusNow === "active" || statusNow === "grace" ? Math.max(prevUntil, now) : now;
    const paidUntilMs = base + days * DAY_MS;
    const balanceDue = prevBalance + charge;
    tx.update(ref, {
      paidUntilMs,
      balanceDue,
      status: "grace",
      graceUntilMs: paidUntilMs,
      approvalStatus: "approved",
      approvedAtMs: now,
      updatedAtMs: now,
    });
    tx.set(ref.collection("payments").doc(), {
      amount: 0,
      kind: "extension",
      daysGranted: days,
      balanceAdded: charge,
      note: ledgerNote,
      atMs: now,
      byUid: owner.uid,
      collectedByUid: owner.uid,
      collectedByEmail: owner.email,
      locationId: site.locationId,
      locationName: site.locationName,
      channel: site.locationId === OWNER_DESK_OUTLET.locationId ? "desk" : "pos",
    });
    return { paidUntilMs, status: "grace" as const, balanceDue, balanceAdded: charge, daysGranted: days };
  });

  await writeAudit({
    action: "grant_day_extension",
    adminEmail: owner.email,
    targetUid: customerId,
    detail: `${days}d charge ${charge} note=${ledgerNote}`,
  });

  const customer = await ref.get();
  await sendToToken(
    customer.get("fcmToken") as string | undefined,
    "GlobalNetwork service updated",
    `Your internet service is extended ${days} day${days === 1 ? "" : "s"} to ${new Date(result.paidUntilMs).toLocaleDateString()}. EC$${charge} was added to your balance.`,
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
    const email = normalizeEmail(claims?.email);
    if (!uid || !email) {
      throw new HttpsError("unauthenticated", "Sign in with a Google or email account that has an email address.");
    }

    const byUid = await customerByUid(uid);
    const matches = await customersWithEmail(email);
    const pool = [...matches];
    if (byUid && !pool.some((doc) => doc.id === byUid.id)) pool.push(byUid);

    if (pool.length) {
      const keeper = pickCustomerKeeper(pool);
      const current = String(keeper.get("approvalStatus") ?? "");
      const patch: Record<string, unknown> = { uid, email, lastSeenMs: Date.now() };
      if (!current) {
        const createdBy = String(keeper.get("createdBy") ?? "");
        const hasKyc = Boolean(keeper.get("idPhotoUrl") || keeper.get("kycSubmittedAtMs"));
        patch.approvalStatus = createdBy === uid && !hasKyc ? "none" : "approved";
      }
      await keeper.ref.update(patch);
      await Promise.all(
        pool
          .filter((doc) => doc.id !== keeper.id && String(doc.get("uid") ?? "") === uid)
          .map((doc) => doc.ref.update({ uid: null, updatedAtMs: Date.now() })),
      );
      return { customerId: keeper.id };
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
  try {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
    const customerId = String(request.data?.customerId ?? "").trim();
    const name = String(request.data?.name ?? "").trim();
    const phone = String(request.data?.phone ?? "").trim();
    const idPhotoUrl = String(request.data?.idPhotoUrl ?? "").trim();
    const billingPhotoUrl = String(request.data?.billingPhotoUrl ?? "").trim();
    const addressRaw = String(request.data?.address ?? "").trim();
    const locationLabel = String(request.data?.locationLabel ?? "").trim();
    const lat = Number(request.data?.lat);
    const lng = Number(request.data?.lng);
    const coordHit = COORD.exec(addressRaw);
    const pinLat = Number.isFinite(lat) ? lat : coordHit ? Number(coordHit[1]) : null;
    const pinLng = Number.isFinite(lng) ? lng : coordHit ? Number(coordHit[2]) : null;
    const address = coordHit ? locationLabel || "Shared pin in Antigua" : addressRaw;
    if (!customerId || !name || !phone || !address || !idPhotoUrl || !billingPhotoUrl) {
      throw new HttpsError("invalid-argument", "Name, phone, village / area, ID photo, and billing-address photo are required.");
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
      rejectionReason: "",
      lastSeenMs: Date.now(),
      ...(pinLat != null && pinLng != null ? { lat: pinLat, lng: pinLng, locationLabel: locationLabel || address } : {}),
    });
    await sendToOwners("New GlobalNetwork application", `${name} submitted ID and billing photos for approval.`, {
      type: "application",
      customerId,
    });
    return { ok: true, customerId };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error("submitCustomerApplication failed", error);
    throw new HttpsError("unavailable", "Could not send your application. Try again.");
  }
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
      rejectionReason: FieldValue.delete(),
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
