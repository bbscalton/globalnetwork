import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { CALLABLE, CURRENCY, DAY_EXTENSION_RATE_XCD, DEFAULT_ORG_ID, DEFAULT_PLANS, FieldValue, db, formatAntiguaDate, paidUntilAfterGrant, requireManager, requireOwner, requirePosStaff, sendToOwners, sendToToken, writeAudit, type StaffSession } from "./context";
import { customerByUid, customersWithEmail, customersWithPhone, normalizeEmail, normalizePhone, pickCustomerKeeper } from "./customerRecords";

const COORD = /^\s*(-?\d{1,2}\.\d+)\s*[ ,]\s*(-?\d{1,3}\.\d+)\s*$/;
const OWNER_DESK_OUTLET = { locationId: "owner-desk", locationName: "Owner desk" };

type DueFields = { get: (field: string) => unknown };

/** Balance formula: planDue + extensionDue. Legacy docs without the split treat balanceDue as plan due. */
function readDues(snap: DueFields): { planDue: number; extensionDue: number } {
  const hasPlan = snap.get("planDue") != null;
  const hasExt = snap.get("extensionDue") != null;
  if (hasPlan || hasExt) {
    return {
      planDue: Math.max(0, Number(snap.get("planDue") ?? 0)),
      extensionDue: Math.max(0, Number(snap.get("extensionDue") ?? 0)),
    };
  }
  return {
    planDue: Math.max(0, Number(snap.get("balanceDue") ?? 0)),
    extensionDue: 0,
  };
}

function totalDue(planDue: number, extensionDue: number): number {
  return Math.max(0, planDue) + Math.max(0, extensionDue);
}

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
  const orgUpdate: Record<string, unknown> = {
    ownerEmail: owner.email,
    ownerUid: owner.uid,
    ownerLastSeenMs: Date.now(),
  };
  const memberUpdate: Record<string, unknown> = {
    uid: owner.uid,
    email: owner.email,
    lastSeenMs: Date.now(),
  };
  // Only overwrite FCM when a real token is provided. Empty calls from browsers
  // without web push must not wipe the desk APK token.
  if (token) {
    orgUpdate.ownerFcmToken = token;
    memberUpdate.fcmToken = token;
  }
  await db.collection("orgs").doc(orgId).set(orgUpdate, { merge: true });
  await db.collection("deskMembers").doc(owner.uid).set(memberUpdate, { merge: true });
  return { ok: true, registered: Boolean(token) };
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
          patch.planDue = feeAmount;
          patch.extensionDue = 0;
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
    planDue: feeAmount,
    extensionDue: 0,
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

/**
 * Collect the full package/monthly plan fee (no partial plan payments).
 * Clears planDue. If amountPaid also covers extensionDue, clears that too (does not clear plan when only paying extension — use grantDayExtension paidNow for extension-only cash).
 */
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
  if (!Number.isFinite(amountPaid) || amountPaid < 0) {
    throw new HttpsError("invalid-argument", "amountPaid cannot be negative.");
  }

  const ref = db.collection("customers").doc(customerId);
  const now = Date.now();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Customer not found.");
    const feeAmount = Number(snap.get("feeAmount") ?? 0);
    if (feeAmount <= 0) {
      throw new HttpsError("failed-precondition", "Assign a package with a fee before collecting the plan.");
    }
    if (amountPaid + 1e-9 < feeAmount) {
      throw new HttpsError(
        "invalid-argument",
        `Plan collect requires the full fee of EC$${feeAmount}. Partial plan payments are not allowed.`,
      );
    }

    const dues = readDues(snap);
    const prevPaid = Number(snap.get("paidAmount") ?? 0);
    const prevUntil = Number(snap.get("paidUntilMs") ?? 0);
    const statusNow = String(snap.get("status") ?? "expired");
    const stillActive = (statusNow === "active" || statusNow === "grace") && prevUntil > now;
    const paidUntilMs = paidUntilAfterGrant(prevUntil, days, now, stillActive);

    let extensionDue = dues.extensionDue;
    const towardExtension = Math.max(0, amountPaid - feeAmount);
    // Only clear extension in the same call when the overage covers the full extensionDue.
    const extensionCollected =
      dues.extensionDue > 0 && towardExtension + 1e-9 >= dues.extensionDue ? dues.extensionDue : 0;
    extensionDue = Math.max(0, extensionDue - extensionCollected);
    const planDue = 0;
    const balanceDue = totalDue(planDue, extensionDue);
    const paidAmount = prevPaid + amountPaid;

    const payMeta = {
      atMs: now,
      byUid: owner.uid,
      collectedByUid: owner.uid,
      collectedByEmail: owner.email,
      locationId: site.locationId,
      locationName: site.locationName,
      channel: site.locationId === OWNER_DESK_OUTLET.locationId ? "desk" : "pos",
    };

    tx.update(ref, {
      paidUntilMs,
      paidAmount,
      planDue,
      extensionDue,
      balanceDue,
      status: "active",
      graceUntilMs: null,
      lastPaymentAmount: amountPaid,
      lastPaymentMs: now,
      approvalStatus: "approved",
      approvedAtMs: now,
      updatedAtMs: now,
    });
    tx.set(ref.collection("payments").doc(), {
      amount: feeAmount,
      kind: "full",
      daysGranted: days,
      note: note || "Plan due collected",
      planCollected: feeAmount,
      extensionCollected: 0,
      ...payMeta,
    });
    if (extensionCollected > 0) {
      tx.set(ref.collection("payments").doc(), {
        amount: extensionCollected,
        kind: "extension",
        daysGranted: 0,
        balanceAdded: 0,
        note: note || "Extension due collected with plan",
        planCollected: 0,
        extensionCollected,
        ...payMeta,
      });
    }
    return { paidUntilMs, status: "active" as const, balanceDue, planDue, extensionDue, extensionCollected };
  });

  await writeAudit({
    action: "extend_subscription",
    adminEmail: owner.email,
    targetUid: customerId,
    detail: `${days}d paid ${amountPaid} planDue=0 extDue=${result.extensionDue} note=${note}`,
  });

  const customer = await ref.get();
  await sendToToken(
    customer.get("fcmToken") as string | undefined,
    "GlobalNetwork service updated",
    `Your internet service is extended to ${formatAntiguaDate(result.paidUntilMs)}.`,
    { type: "subscription", customerId },
  );

  // Auto-unblock CPE on payment (fire and forget)
  import("./omadaOpenApi")
    .then(({ unblockCustomerCpeOnPayment }) => unblockCustomerCpeOnPayment(customerId))
    .catch((err) => logger.warn("omada_unblock_import_failed", { customerId, error: err instanceof Error ? err.message : String(err) }));

  return result;
});

/**
 * Grant day extensions at EC$6/day.
 * paidNow=false (default): charge to balance → stacks extensionDue (does not touch planDue).
 * paidNow=true: collect days*6 now, grant days, do not add to extensionDue.
 */
export const grantDayExtension = onCall(CALLABLE, async (request) => {
  const owner = await requireManager(request);
  const customerId = String(request.data?.customerId ?? "");
  const days = Math.floor(Number(request.data?.days ?? 0));
  const note = String(request.data?.note ?? "").trim();
  const paidNow = request.data?.paidNow === true || request.data?.collectNow === true;
  const site = collectionSite(request.data, owner);
  if (!customerId || !Number.isFinite(days) || days < 1) {
    throw new HttpsError("invalid-argument", "customerId and days (>= 1) are required.");
  }

  const charge = days * DAY_EXTENSION_RATE_XCD;
  const ledgerNote =
    note ||
    (paidNow
      ? `${days}-day extension @ EC$${DAY_EXTENSION_RATE_XCD}/day · EC$${charge} collected now`
      : `${days}-day extension @ EC$${DAY_EXTENSION_RATE_XCD}/day · EC$${charge} charged to balance`);

  const ref = db.collection("customers").doc(customerId);
  const now = Date.now();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Customer not found.");
    const prevUntil = Number(snap.get("paidUntilMs") ?? 0);
    const statusNow = String(snap.get("status") ?? "expired");
    const dues = readDues(snap);
    const stillActive = (statusNow === "active" || statusNow === "grace") && prevUntil > now;
    const paidUntilMs = paidUntilAfterGrant(prevUntil, days, now, stillActive);
    const planDue = dues.planDue;
    const extensionDue = paidNow ? dues.extensionDue : dues.extensionDue + charge;
    const balanceDue = totalDue(planDue, extensionDue);
    const prevPaid = Number(snap.get("paidAmount") ?? 0);

    const patch: Record<string, unknown> = {
      paidUntilMs,
      planDue,
      extensionDue,
      balanceDue,
      status: "grace",
      graceUntilMs: paidUntilMs,
      approvalStatus: "approved",
      approvedAtMs: now,
      updatedAtMs: now,
    };
    if (paidNow) {
      patch.paidAmount = prevPaid + charge;
      patch.lastPaymentAmount = charge;
      patch.lastPaymentMs = now;
    }
    tx.update(ref, patch);
    tx.set(ref.collection("payments").doc(), {
      amount: paidNow ? charge : 0,
      kind: "extension",
      daysGranted: days,
      balanceAdded: paidNow ? 0 : charge,
      note: ledgerNote,
      paidNow,
      atMs: now,
      byUid: owner.uid,
      collectedByUid: owner.uid,
      collectedByEmail: owner.email,
      locationId: site.locationId,
      locationName: site.locationName,
      channel: site.locationId === OWNER_DESK_OUTLET.locationId ? "desk" : "pos",
    });
    return {
      paidUntilMs,
      status: "grace" as const,
      balanceDue,
      planDue,
      extensionDue,
      balanceAdded: paidNow ? 0 : charge,
      amountCollected: paidNow ? charge : 0,
      daysGranted: days,
      paidNow,
    };
  });

  await writeAudit({
    action: "grant_day_extension",
    adminEmail: owner.email,
    targetUid: customerId,
    detail: `${days}d ${paidNow ? "paid" : "charged"} ${charge} note=${ledgerNote}`,
  });

  const customer = await ref.get();
  await sendToToken(
    customer.get("fcmToken") as string | undefined,
    "GlobalNetwork service updated",
    paidNow
      ? `Your internet service is extended ${days} day${days === 1 ? "" : "s"} to ${formatAntiguaDate(result.paidUntilMs)}. EC$${charge} was collected.`
      : `Your internet service is extended ${days} day${days === 1 ? "" : "s"} to ${formatAntiguaDate(result.paidUntilMs)}. EC$${charge} was added to your extension balance.`,
    { type: "subscription", customerId },
  );

  // Auto-unblock CPE on extension (fire and forget)
  import("./omadaOpenApi")
    .then(({ unblockCustomerCpeOnPayment }) => unblockCustomerCpeOnPayment(customerId))
    .catch((err) => logger.warn("omada_unblock_import_failed", { customerId, error: err instanceof Error ? err.message : String(err) }));

  return result;
});

/**
 * Collect a payment (partial or full) and optionally grant service days.
 * 
 * Unlike extendSubscription which requires full plan fee:
 * - Accepts any positive amount
 * - Records payment against the customer's balance
 * - Balance = planDue + extensionDue - payments applied
 * - Can grant service days even with outstanding balance (grantDays option)
 * 
 * Balance tracking:
 * - `totalOwed`: Total amount owed (plan fee + extensions charged)
 * - `totalPaid`: Total amount collected to date
 * - `balanceOwed`: totalOwed - totalPaid (can be negative for overpayment/credit)
 * - All stored server-side, never trust client-computed values
 */
export const collectPayment = onCall(CALLABLE, async (request) => {
  const staff = await requirePosStaff(request);
  const customerId = String(request.data?.customerId ?? "");
  const amountPaid = Number(request.data?.amountPaid ?? 0);
  const grantDays = Math.floor(Number(request.data?.grantDays ?? 0));
  const note = String(request.data?.note ?? "").trim();
  const site = collectionSite(request.data, staff);
  
  if (!customerId) {
    throw new HttpsError("invalid-argument", "customerId is required.");
  }
  if (!Number.isFinite(amountPaid) || amountPaid <= 0) {
    throw new HttpsError("invalid-argument", "amountPaid must be a positive number.");
  }
  if (grantDays < 0) {
    throw new HttpsError("invalid-argument", "grantDays cannot be negative.");
  }
  
  const ref = db.collection("customers").doc(customerId);
  const now = Date.now();
  
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Customer not found.");
    
    const feeAmount = Number(snap.get("feeAmount") ?? 0);
    const dues = readDues(snap);
    const prevTotalOwed = Number(snap.get("totalOwed") ?? dues.planDue + dues.extensionDue);
    const prevTotalPaid = Number(snap.get("totalPaid") ?? Number(snap.get("paidAmount") ?? 0));
    const prevBalanceOwed = Number(snap.get("balanceOwed") ?? prevTotalOwed - prevTotalPaid);
    const prevUntil = Number(snap.get("paidUntilMs") ?? 0);
    const statusNow = String(snap.get("status") ?? "expired");
    
    // Apply payment to balance
    const totalPaid = prevTotalPaid + amountPaid;
    const balanceOwed = Math.max(0, prevTotalOwed - totalPaid);
    
    // Calculate how much of the payment goes to plan vs extension
    let planCollected = 0;
    let extensionCollected = 0;
    let remaining = amountPaid;
    
    // Apply to plan due first
    if (dues.planDue > 0 && remaining > 0) {
      planCollected = Math.min(dues.planDue, remaining);
      remaining -= planCollected;
    }
    // Then apply to extension due
    if (dues.extensionDue > 0 && remaining > 0) {
      extensionCollected = Math.min(dues.extensionDue, remaining);
      remaining -= extensionCollected;
    }
    
    const newPlanDue = Math.max(0, dues.planDue - planCollected);
    const newExtensionDue = Math.max(0, dues.extensionDue - extensionCollected);
    const newBalanceDue = totalDue(newPlanDue, newExtensionDue);
    
    // Optionally grant service days
    let paidUntilMs = prevUntil;
    let newStatus = statusNow;
    if (grantDays > 0) {
      const stillActive = (statusNow === "active" || statusNow === "grace") && prevUntil > now;
      paidUntilMs = paidUntilAfterGrant(prevUntil, grantDays, now, stillActive);
      newStatus = planCollected >= feeAmount ? "active" : "grace";
    }
    
    const payMeta = {
      atMs: now,
      byUid: staff.uid,
      collectedByUid: staff.uid,
      collectedByEmail: staff.email,
      locationId: site.locationId,
      locationName: site.locationName,
      channel: site.locationId === OWNER_DESK_OUTLET.locationId ? "desk" : "pos",
    };
    
    const customerUpdate: Record<string, unknown> = {
      totalPaid,
      totalOwed: prevTotalOwed,
      balanceOwed,
      planDue: newPlanDue,
      extensionDue: newExtensionDue,
      balanceDue: newBalanceDue,
      paidAmount: totalPaid,
      lastPaymentAmount: amountPaid,
      lastPaymentMs: now,
      updatedAtMs: now,
    };
    
    if (grantDays > 0) {
      customerUpdate.paidUntilMs = paidUntilMs;
      customerUpdate.status = newStatus;
      if (newStatus === "grace") {
        customerUpdate.graceUntilMs = paidUntilMs;
      } else {
        customerUpdate.graceUntilMs = null;
      }
      customerUpdate.approvalStatus = "approved";
      customerUpdate.approvedAtMs = now;
    }
    
    tx.update(ref, customerUpdate);
    
    // Record the payment
    tx.set(ref.collection("payments").doc(), {
      amount: amountPaid,
      kind: grantDays > 0 ? (planCollected >= feeAmount ? "full" : "partial") : "partial",
      daysGranted: grantDays,
      note: note || (grantDays > 0 
        ? `Partial payment EC$${amountPaid} · ${grantDays} days granted with EC$${balanceOwed.toFixed(2)} balance`
        : `Payment toward balance · EC$${amountPaid}`),
      planCollected,
      extensionCollected,
      balanceOwedBefore: prevBalanceOwed,
      balanceOwedAfter: balanceOwed,
      ...payMeta,
    });
    
    return {
      paidUntilMs,
      status: newStatus,
      amountPaid,
      daysGranted: grantDays,
      totalOwed: prevTotalOwed,
      totalPaid,
      balanceOwed,
      planDue: newPlanDue,
      extensionDue: newExtensionDue,
      balanceDue: newBalanceDue,
      planCollected,
      extensionCollected,
    };
  });
  
  await writeAudit({
    action: "collect_payment",
    adminEmail: staff.email,
    targetUid: customerId,
    detail: `EC$${amountPaid} paid · ${grantDays}d granted · balance EC$${result.balanceOwed.toFixed(2)}`,
  });
  
  const customer = await ref.get();
  if (grantDays > 0) {
    await sendToToken(
      customer.get("fcmToken") as string | undefined,
      "GlobalNetwork payment received",
      result.balanceOwed > 0
        ? `EC$${amountPaid} received. Service extended to ${formatAntiguaDate(result.paidUntilMs)}. Balance owed: EC$${result.balanceOwed.toFixed(2)}.`
        : `EC$${amountPaid} received. Service extended to ${formatAntiguaDate(result.paidUntilMs)}. Paid in full!`,
      { type: "payment", customerId },
    );
  } else {
    await sendToToken(
      customer.get("fcmToken") as string | undefined,
      "GlobalNetwork payment received",
      result.balanceOwed > 0
        ? `EC$${amountPaid} received toward your balance. Remaining: EC$${result.balanceOwed.toFixed(2)}.`
        : `EC$${amountPaid} received. Your balance is now paid in full!`,
      { type: "payment", customerId },
    );
  }
  
  // Auto-unblock CPE on payment (fire and forget) - especially important for partial payments with days granted
  if (grantDays > 0) {
    import("./omadaOpenApi")
      .then(({ unblockCustomerCpeOnPayment }) => unblockCustomerCpeOnPayment(customerId))
      .catch((err) => logger.warn("omada_unblock_import_failed", { customerId, error: err instanceof Error ? err.message : String(err) }));
  }
  
  return result;
});

/**
 * Add charges to a customer's balance without collecting payment.
 * Used to record plan fees or other charges.
 */
export const addCharge = onCall(CALLABLE, async (request) => {
  const staff = await requireManager(request);
  const customerId = String(request.data?.customerId ?? "");
  const amount = Number(request.data?.amount ?? 0);
  const description = String(request.data?.description ?? "").trim();
  const chargeType = String(request.data?.chargeType ?? "plan").trim();
  
  if (!customerId) {
    throw new HttpsError("invalid-argument", "customerId is required.");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpsError("invalid-argument", "amount must be a positive number.");
  }
  
  const ref = db.collection("customers").doc(customerId);
  const now = Date.now();
  
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Customer not found.");
    
    const dues = readDues(snap);
    const prevTotalOwed = Number(snap.get("totalOwed") ?? dues.planDue + dues.extensionDue);
    const prevTotalPaid = Number(snap.get("totalPaid") ?? Number(snap.get("paidAmount") ?? 0));
    
    const totalOwed = prevTotalOwed + amount;
    const balanceOwed = Math.max(0, totalOwed - prevTotalPaid);
    
    let newPlanDue = dues.planDue;
    let newExtensionDue = dues.extensionDue;
    
    if (chargeType === "extension") {
      newExtensionDue += amount;
    } else {
      newPlanDue += amount;
    }
    
    tx.update(ref, {
      totalOwed,
      balanceOwed,
      planDue: newPlanDue,
      extensionDue: newExtensionDue,
      balanceDue: totalDue(newPlanDue, newExtensionDue),
      updatedAtMs: now,
    });
    
    return { totalOwed, balanceOwed, planDue: newPlanDue, extensionDue: newExtensionDue };
  });
  
  await writeAudit({
    action: "add_charge",
    adminEmail: staff.email,
    targetUid: customerId,
    detail: `${chargeType}: EC$${amount} - ${description || "No description"}`,
  });
  
  return { ok: true, ...result, chargeType, amount, description };
});

/**
 * Get the current balance summary for a customer.
 */
export const getBalanceSummary = onCall(CALLABLE, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  
  const customerId = String(request.data?.customerId ?? "");
  if (!customerId) {
    throw new HttpsError("invalid-argument", "customerId is required.");
  }
  
  const ref = db.collection("customers").doc(customerId);
  const snap = await ref.get();
  
  if (!snap.exists) {
    throw new HttpsError("not-found", "Customer not found.");
  }
  
  // Check ownership or staff access
  const isOwn = snap.get("uid") === uid;
  if (!isOwn) {
    // Check if user is staff
    const memberSnap = await db.collection("deskMembers").doc(uid).get();
    const role = memberSnap.exists ? String(memberSnap.get("role") ?? "") : "";
    if (role !== "owner" && role !== "manager" && role !== "cashier") {
      throw new HttpsError("permission-denied", "Not authorized to view this customer.");
    }
  }
  
  const dues = readDues(snap);
  const totalOwed = Number(snap.get("totalOwed") ?? dues.planDue + dues.extensionDue);
  const totalPaid = Number(snap.get("totalPaid") ?? Number(snap.get("paidAmount") ?? 0));
  const balanceOwed = Number(snap.get("balanceOwed") ?? Math.max(0, totalOwed - totalPaid));
  
  return {
    customerId,
    totalOwed,
    totalPaid,
    balanceOwed,
    planDue: dues.planDue,
    extensionDue: dues.extensionDue,
    balanceDue: totalDue(dues.planDue, dues.extensionDue),
    feeAmount: Number(snap.get("feeAmount") ?? 0),
    paidUntilMs: snap.get("paidUntilMs") ?? null,
    status: String(snap.get("status") ?? "expired"),
    currency: CURRENCY,
  };
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
      // NEVER auto-approve on account linking. All new sign-ins must wait for owner approval.
      // Only set approvalStatus if it's missing/empty, and always set to "pending" so owner must approve.
      // Exception: if the record was already approved by an owner, keep it approved.
      if (!current) {
        // Customer record has no approvalStatus - set to pending for owner review
        patch.approvalStatus = "pending";
        logger.info("linkCustomerAccount: setting pending approval for customer without status", {
          customerId: keeper.id,
          email,
        });
      }
      // If current is "approved", "pending", "rejected", or "none" - leave it as is
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
      planDue: 0,
      extensionDue: 0,
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

/**
 * Customer requests a day extension from the app.
 * Price is computed server-side at EC$6/day (DAY_EXTENSION_RATE_XCD).
 * Creates an extension request for owner/POS approval.
 * The expiry is set from server time in Antigua timezone.
 */
export const requestDayExtension = onCall(CALLABLE, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  
  const customerId = String(request.data?.customerId ?? "").trim();
  const days = Math.floor(Number(request.data?.days ?? 0));
  
  if (!customerId) {
    throw new HttpsError("invalid-argument", "customerId is required.");
  }
  if (!Number.isFinite(days) || days < 1 || days > 90) {
    throw new HttpsError("invalid-argument", "Days must be between 1 and 90.");
  }
  
  const ref = db.collection("customers").doc(customerId);
  const snap = await ref.get();
  
  if (!snap.exists) {
    throw new HttpsError("not-found", "Customer not found.");
  }
  if (snap.get("uid") !== uid) {
    throw new HttpsError("permission-denied", "Not your customer record.");
  }
  
  // Server-side price computation - never trust client price
  const totalXcd = days * DAY_EXTENSION_RATE_XCD;
  const now = Date.now();
  
  // Create extension request for owner/POS approval
  const requestRef = await db.collection("extensionRequests").add({
    customerId,
    customerName: String(snap.get("name") ?? ""),
    customerEmail: String(snap.get("email") ?? ""),
    customerPhone: String(snap.get("phone") ?? ""),
    uid,
    days,
    ratePerDay: DAY_EXTENSION_RATE_XCD,
    totalXcd,
    status: "pending",
    requestedAtMs: now,
    currentPaidUntilMs: Number(snap.get("paidUntilMs") ?? 0),
    currentStatus: String(snap.get("status") ?? "expired"),
  });
  
  // Notify owners
  await sendToOwners(
    "Extension request",
    `${String(snap.get("name") ?? "A customer")} requested ${days} day${days === 1 ? "" : "s"} extension (EC$${totalXcd}).`,
    { type: "extension_request", requestId: requestRef.id, customerId },
  );
  
  // Update customer with pending request
  await ref.update({
    pendingExtensionRequestId: requestRef.id,
    pendingExtensionDays: days,
    pendingExtensionTotal: totalXcd,
    lastSeenMs: now,
  });
  
  logger.info("Extension request created", { requestId: requestRef.id, customerId, days, totalXcd });
  
  return {
    ok: true,
    requestId: requestRef.id,
    days,
    ratePerDay: DAY_EXTENSION_RATE_XCD,
    totalXcd,
    status: "pending",
    message: `Your request for ${days} day${days === 1 ? "" : "s"} (EC$${totalXcd}) has been sent to GlobalNetwork. They will contact you about payment.`,
  };
});

/**
 * Owner/POS approves or rejects a customer extension request.
 * On approval, grants the days and records payment if paidNow=true.
 */
export const processExtensionRequest = onCall(CALLABLE, async (request) => {
  const staff = await requirePosStaff(request);
  
  const requestId = String(request.data?.requestId ?? "").trim();
  const decision = String(request.data?.decision ?? "").trim().toLowerCase();
  const paidNow = request.data?.paidNow === true;
  const reason = String(request.data?.reason ?? "").trim();
  const site = collectionSite(request.data, staff);
  
  if (!requestId || (decision !== "approved" && decision !== "rejected")) {
    throw new HttpsError("invalid-argument", "requestId and decision (approved|rejected) are required.");
  }
  
  const reqRef = db.collection("extensionRequests").doc(requestId);
  const reqSnap = await reqRef.get();
  
  if (!reqSnap.exists) {
    throw new HttpsError("not-found", "Extension request not found.");
  }
  
  const status = String(reqSnap.get("status") ?? "");
  if (status !== "pending") {
    throw new HttpsError("failed-precondition", `Request already ${status}.`);
  }
  
  const customerId = String(reqSnap.get("customerId") ?? "");
  const days = Number(reqSnap.get("days") ?? 0);
  const totalXcd = Number(reqSnap.get("totalXcd") ?? days * DAY_EXTENSION_RATE_XCD);
  const now = Date.now();
  
  const customerRef = db.collection("customers").doc(customerId);
  const customerSnap = await customerRef.get();
  
  if (!customerSnap.exists) {
    throw new HttpsError("not-found", "Customer no longer exists.");
  }
  
  if (decision === "rejected") {
    await reqRef.update({
      status: "rejected",
      rejectedAtMs: now,
      rejectedBy: staff.email,
      rejectionReason: reason,
    });
    
    await customerRef.update({
      pendingExtensionRequestId: null,
      pendingExtensionDays: null,
      pendingExtensionTotal: null,
    });
    
    await sendToToken(
      customerSnap.get("fcmToken") as string | undefined,
      "Extension request",
      reason || "Your extension request was not approved. Please contact GlobalNetwork.",
      { type: "extension_request", requestId, customerId },
    );
    
    await writeAudit({
      action: "extension_request_rejected",
      adminEmail: staff.email,
      targetUid: customerId,
      detail: `${days}d EC$${totalXcd} - ${reason || "rejected"}`,
    });
    
    return { ok: true, decision: "rejected" };
  }
  
  // Approved - grant the extension
  const prevUntil = Number(customerSnap.get("paidUntilMs") ?? 0);
  const statusNow = String(customerSnap.get("status") ?? "expired");
  const stillActive = (statusNow === "active" || statusNow === "grace") && prevUntil > now;
  const paidUntilMs = paidUntilAfterGrant(prevUntil, days, now, stillActive);
  
  const prevPaid = Number(customerSnap.get("paidAmount") ?? 0);
  const prevExtDue = Number(customerSnap.get("extensionDue") ?? 0);
  const prevPlanDue = Number(customerSnap.get("planDue") ?? 0);
  
  const extensionDue = paidNow ? prevExtDue : prevExtDue + totalXcd;
  const balanceDue = prevPlanDue + extensionDue;
  
  const customerPatch: Record<string, unknown> = {
    paidUntilMs,
    status: "grace",
    graceUntilMs: paidUntilMs,
    extensionDue,
    balanceDue,
    pendingExtensionRequestId: null,
    pendingExtensionDays: null,
    pendingExtensionTotal: null,
    updatedAtMs: now,
  };
  
  if (paidNow) {
    customerPatch.paidAmount = prevPaid + totalXcd;
    customerPatch.lastPaymentAmount = totalXcd;
    customerPatch.lastPaymentMs = now;
  }
  
  await customerRef.update(customerPatch);
  
  // Record payment
  await customerRef.collection("payments").add({
    amount: paidNow ? totalXcd : 0,
    kind: "extension",
    daysGranted: days,
    balanceAdded: paidNow ? 0 : totalXcd,
    note: `Customer-requested ${days}-day extension @ EC$${DAY_EXTENSION_RATE_XCD}/day`,
    paidNow,
    atMs: now,
    byUid: staff.uid,
    collectedByUid: staff.uid,
    collectedByEmail: staff.email,
    locationId: site.locationId,
    locationName: site.locationName,
    channel: site.locationId === OWNER_DESK_OUTLET.locationId ? "desk" : "pos",
    fromExtensionRequest: requestId,
  });
  
  await reqRef.update({
    status: "approved",
    approvedAtMs: now,
    approvedBy: staff.email,
    paidNow,
    grantedPaidUntilMs: paidUntilMs,
    processedAt: site.locationName,
  });
  
  await sendToToken(
    customerSnap.get("fcmToken") as string | undefined,
    "Extension approved",
    paidNow
      ? `Your ${days}-day extension is active! Service valid until ${formatAntiguaDate(paidUntilMs)}. EC$${totalXcd} was collected.`
      : `Your ${days}-day extension is active! Service valid until ${formatAntiguaDate(paidUntilMs)}. EC$${totalXcd} was added to your balance.`,
    { type: "extension_request", requestId, customerId },
  );
  
  await writeAudit({
    action: "extension_request_approved",
    adminEmail: staff.email,
    targetUid: customerId,
    detail: `${days}d EC$${totalXcd} ${paidNow ? "paid" : "charged"} until ${formatAntiguaDate(paidUntilMs)}`,
  });
  
  return {
    ok: true,
    decision: "approved",
    paidUntilMs,
    days,
    totalXcd,
    paidNow,
  };
});

/**
 * Get the current extension rate for display in the customer app.
 * Returns the rate so clients don't hardcode it.
 */
export const getExtensionRate = onCall(CALLABLE, async () => {
  return {
    ratePerDay: DAY_EXTENSION_RATE_XCD,
    currency: CURRENCY,
    minDays: 1,
    maxDays: 90,
  };
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

/**
 * Request to link a customer account by phone number.
 * This is a two-step process for security:
 * 1. Customer calls requestPhoneLink with their phone number
 * 2. Owner approves via approvePhoneLink
 * 
 * This prevents anyone from claiming another customer's account just by knowing their phone.
 */
export const requestPhoneLink = onCall(CALLABLE, async (request) => {
  const uid = request.auth?.uid;
  const claims = request.auth?.token as Record<string, unknown> | undefined;
  const email = normalizeEmail(claims?.email);
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  
  const phone = normalizePhone(request.data?.phone);
  if (!phone || phone.length < 7) {
    throw new HttpsError("invalid-argument", "Enter a valid phone number.");
  }
  
  // Check if user already has a linked account
  const existing = await customerByUid(uid);
  if (existing) {
    throw new HttpsError("already-exists", "You already have a linked account.");
  }
  
  // Find customers with this phone
  const matches = await customersWithPhone(phone);
  if (matches.length === 0) {
    throw new HttpsError("not-found", "No customer found with this phone number. Contact GlobalNetwork to create your account.");
  }
  
  // Store the link request for owner approval
  const target = pickCustomerKeeper(matches);
  const now = Date.now();
  await db.collection("phoneLinkRequests").doc(uid).set({
    uid,
    email: email || null,
    phone,
    targetCustomerId: target.id,
    targetCustomerName: String(target.get("name") ?? ""),
    status: "pending",
    requestedAtMs: now,
  });
  
  await sendToOwners(
    "Phone link request",
    `${email || "A user"} is requesting to link to customer ${String(target.get("name") ?? target.id)} by phone ${phone}.`,
    { type: "phone_link", requestUid: uid },
  );
  
  return { ok: true, status: "pending", message: "Link request sent to GlobalNetwork for approval." };
});

/**
 * Owner approves or rejects a phone link request.
 */
export const approvePhoneLink = onCall(CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const requestUid = String(request.data?.uid ?? "").trim();
  const decision = String(request.data?.decision ?? "").trim().toLowerCase();
  const reason = String(request.data?.reason ?? "").trim();
  
  if (!requestUid || (decision !== "approved" && decision !== "rejected")) {
    throw new HttpsError("invalid-argument", "uid and decision (approved|rejected) are required.");
  }
  
  const reqRef = db.collection("phoneLinkRequests").doc(requestUid);
  const reqSnap = await reqRef.get();
  if (!reqSnap.exists) {
    throw new HttpsError("not-found", "Phone link request not found.");
  }
  
  const status = String(reqSnap.get("status") ?? "");
  if (status !== "pending") {
    throw new HttpsError("failed-precondition", `Request already ${status}.`);
  }
  
  const now = Date.now();
  
  if (decision === "rejected") {
    await reqRef.update({
      status: "rejected",
      rejectedAtMs: now,
      rejectedBy: owner.email,
      rejectionReason: reason,
    });
    await writeAudit({
      action: "phone_link_rejected",
      adminEmail: owner.email,
      targetUid: requestUid,
      detail: reason || "rejected",
    });
    return { ok: true, decision: "rejected" };
  }
  
  // Approve: link the customer account
  const targetCustomerId = String(reqSnap.get("targetCustomerId") ?? "");
  const customerRef = db.collection("customers").doc(targetCustomerId);
  const customerSnap = await customerRef.get();
  
  if (!customerSnap.exists) {
    throw new HttpsError("not-found", "Target customer no longer exists.");
  }
  
  await customerRef.update({
    uid: requestUid,
    linkedByPhone: true,
    linkedAtMs: now,
    approvalStatus: "approved",
    approvedAtMs: now,
    approvedBy: owner.email,
  });
  
  await reqRef.update({
    status: "approved",
    approvedAtMs: now,
    approvedBy: owner.email,
  });
  
  await writeAudit({
    action: "phone_link_approved",
    adminEmail: owner.email,
    targetUid: targetCustomerId,
    detail: `linked uid=${requestUid}`,
  });
  
  return { ok: true, decision: "approved", customerId: targetCustomerId };
});
