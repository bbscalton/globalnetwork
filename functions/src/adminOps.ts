import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  FieldPath,
  type CollectionReference,
  type DocumentReference,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import {
  CALLABLE,
  CURRENCY,
  DAY_MS,
  DEFAULT_ORG_ID,
  DEFAULT_PLANS,
  db,
  requireOwner,
  sendToToken,
  writeAudit,
} from "./context";
import { absorbCustomer, normalizeEmail, pickCustomerKeeper } from "./customerRecords";

export const DEFAULT_ORG_SETTINGS = {
  name: "GlobalNetwork",
  currency: CURRENCY,
  supportPhone: "",
  supportWhatsapp: "",
  botEnabled: true,
  callRecordingDefault: false,
  renewalWarnDays: 3,
  timezone: "America/Antigua",
};

const STATUSES = new Set(["active", "grace", "expired", "suspended"]);
const RESET_PHRASE = "RESET GLOBALNETWORK";
const TIDY_TIMEOUT = { ...CALLABLE, timeoutSeconds: 300, memory: "512MiB" as const };
const TIDY_PHRASES: Record<string, string> = {
  clearAllChats: "CLEAR ALL CHATS",
  deleteAllIssues: "DELETE ALL ISSUES",
  deleteRejectedCustomers: "DELETE STALE CUSTOMERS",
  purgeAuditLogs: "PURGE AUDIT LOGS",
};
const TIDY_ACTIONS = new Set([
  "clearAllChats",
  "deleteResolvedIssues",
  "deleteAllIssues",
  "deleteOldChat",
  "purgeCalls",
  "purgeAuditLogs",
  "deleteRejectedCustomers",
  "deleteMediaMessages",
  "mergeDuplicateEmails",
]);

async function wipeQuery(target: Query, recursive = false): Promise<number> {
  let total = 0;
  for (;;) {
    const snap = await target.limit(200).get();
    if (snap.empty) return total;
    if (recursive) {
      await Promise.all(snap.docs.map((doc) => db.recursiveDelete(doc.ref)));
    } else {
      const batch = db.batch();
      for (const doc of snap.docs) batch.delete(doc.ref);
      await batch.commit();
    }
    total += snap.size;
  }
}

function chatKind(data: Record<string, unknown>): string {
  const kind = String(data.kind ?? "text");
  if (kind === "voice" || kind === "video" || kind === "text" || kind === "location" || kind === "call") return kind;
  if (data.lat != null) return "location";
  const url = String(data.mediaUrl ?? "").toLowerCase();
  if (url.includes("/calls/") || url.includes(".webm")) return "call";
  if (url.includes("video") || url.includes(".mp4")) return "video";
  if (url.includes("voice") || url.includes(".m4a") || url.includes("audio")) return "voice";
  return "text";
}

function previewFor(kind: string, text: string): string {
  if (kind === "voice") return "Voice note";
  if (kind === "video") return "Video clip";
  if (kind === "location") return "Shared location";
  if (kind === "call") return text.toLowerCase().includes("recording") ? "Call recording" : "Voice call";
  return text.slice(0, 80) || "Chat message";
}

async function refreshLastChat(customerRef: DocumentReference): Promise<void> {
  const snap = await customerRef.collection("chatMessages").orderBy("createdAtMs", "desc").limit(1).get();
  if (snap.empty) {
    await customerRef.update({
      lastChatPreview: "",
      lastChatAtMs: 0,
      lastChatKind: "",
      lastChatFrom: "",
    });
    return;
  }
  const data = snap.docs[0].data() as Record<string, unknown>;
  const kind = chatKind(data);
  const text = String(data.text ?? "");
  await customerRef.update({
    lastChatPreview: previewFor(kind, text),
    lastChatAtMs: Number(data.createdAtMs ?? Date.now()),
    lastChatKind: kind,
    lastChatFrom: String(data.from ?? ""),
  });
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return fallback;
}

async function wipeMatching(
  col: CollectionReference,
  pred: (data: Record<string, unknown>) => boolean,
  recursive = false,
): Promise<number> {
  let total = 0;
  let last: QueryDocumentSnapshot | undefined;
  for (;;) {
    let q: Query = col.orderBy(FieldPath.documentId()).limit(200);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) return total;
    last = snap.docs[snap.docs.length - 1];
    const hits = snap.docs.filter((doc) => pred(doc.data() as Record<string, unknown>));
    if (hits.length) {
      if (recursive) {
        await Promise.all(hits.map((doc) => db.recursiveDelete(doc.ref)));
      } else {
        const batch = db.batch();
        for (const doc of hits) batch.delete(doc.ref);
        await batch.commit();
      }
      total += hits.length;
    }
    if (snap.size < 200) return total;
  }
}

async function loadAllCustomers(): Promise<QueryDocumentSnapshot[]> {
  const docs: QueryDocumentSnapshot[] = [];
  let last: QueryDocumentSnapshot | undefined;
  for (;;) {
    let q: Query = db.collection("customers").orderBy(FieldPath.documentId()).limit(200);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    docs.push(...snap.docs);
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 200) break;
  }
  return docs;
}

async function mergeDuplicateEmails(): Promise<{ scanned: number; deleted: number; merged: number }> {
  const docs = await loadAllCustomers();
  const groups = new Map<string, QueryDocumentSnapshot[]>();
  for (const doc of docs) {
    const email = normalizeEmail(doc.get("email"));
    if (!email) continue;
    const current = String(doc.get("email") ?? "");
    if (current !== email) {
      await doc.ref.update({ email, updatedAtMs: Date.now() });
    }
    const list = groups.get(email) ?? [];
    list.push(doc);
    groups.set(email, list);
  }

  let deleted = 0;
  let merged = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const keeper = pickCustomerKeeper(group);
    const extras = group.filter((doc) => doc.id !== keeper.id);
    for (const extra of extras) {
      await absorbCustomer(keeper, extra);
      deleted += 1;
    }
    merged += 1;
  }
  return { scanned: docs.length, deleted, merged };
}

async function mapCustomers(work: (ref: DocumentReference, data: DocumentData) => Promise<number>): Promise<{
  scanned: number;
  deleted: number;
}> {
  let scanned = 0;
  let deleted = 0;
  let last: QueryDocumentSnapshot | undefined;
  for (;;) {
    let q: Query = db.collection("customers").orderBy(FieldPath.documentId()).limit(50);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      scanned += 1;
      deleted += await work(doc.ref, doc.data());
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 50) break;
  }
  return { scanned, deleted };
}

async function clearChatFor(ref: DocumentReference): Promise<number> {
  const deleted = await wipeQuery(ref.collection("chatMessages"));
  await ref.update({
    lastChatPreview: "",
    lastChatAtMs: 0,
    lastChatKind: "",
    lastChatFrom: "",
    unreadStaff: 0,
    updatedAtMs: Date.now(),
  });
  return deleted;
}

function isStaleCustomer(data: DocumentData, now: number, olderThanDays: number): boolean {
  if (String(data.approvalStatus ?? "") === "rejected") return true;
  const uid = String(data.uid ?? "").trim();
  if (uid) return false;
  const paidUntil = Number(data.paidUntilMs ?? 0);
  if (paidUntil > now) return false;
  const status = String(data.status ?? "expired");
  if (status !== "expired" && status !== "suspended") return false;
  const createdAt = Number(data.createdAtMs ?? 0);
  const cutoff = now - Math.max(1, olderThanDays) * DAY_MS;
  if (!createdAt) return String(data.approvalStatus ?? "") === "rejected";
  return createdAt < cutoff;
}

function requireTidyPhrase(action: string, confirm: string): void {
  const needed = TIDY_PHRASES[action];
  if (!needed) return;
  if (confirm.trim().toUpperCase() !== needed) {
    throw new HttpsError("invalid-argument", `Type ${needed} to confirm.`);
  }
}

function remainingDays(paidUntilMs: number | null, now: number): number {
  if (!paidUntilMs || paidUntilMs <= now) return 0;
  return Math.ceil((paidUntilMs - now) / DAY_MS);
}

function statusFromTimestamps(paidUntilMs: number, graceUntilMs: number, now: number): "active" | "grace" | "expired" {
  if (paidUntilMs > now) return graceUntilMs > now ? "grace" : "active";
  if (graceUntilMs > now) return "grace";
  return "expired";
}

export const saveOrgSettings = onCall(CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const orgId = String(request.data?.orgId ?? DEFAULT_ORG_ID).trim() || DEFAULT_ORG_ID;
  const name = String(request.data?.name ?? DEFAULT_ORG_SETTINGS.name).trim() || DEFAULT_ORG_SETTINGS.name;
  const supportPhone = String(request.data?.supportPhone ?? "").trim();
  const supportWhatsapp = String(request.data?.supportWhatsapp ?? "").trim();
  const timezone = String(request.data?.timezone ?? DEFAULT_ORG_SETTINGS.timezone).trim() || DEFAULT_ORG_SETTINGS.timezone;
  const renewalWarnDays = Math.max(1, Math.min(30, Math.floor(Number(request.data?.renewalWarnDays ?? 3) || 3)));
  await db
    .collection("orgs")
    .doc(orgId)
    .set(
      {
        name,
        currency: CURRENCY,
        supportPhone,
        supportWhatsapp,
        botEnabled: asBool(request.data?.botEnabled, true),
        callRecordingDefault: asBool(request.data?.callRecordingDefault, false),
        renewalWarnDays,
        timezone,
        updatedAtMs: Date.now(),
        updatedBy: owner.email,
      },
      { merge: true },
    );
  await writeAudit({ action: "save_org_settings", adminEmail: owner.email, targetUid: orgId, detail: name });
  return { ok: true, orgId };
});

export const adjustSubscription = onCall(CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const customerId = String(request.data?.customerId ?? "").trim();
  if (!customerId) throw new HttpsError("invalid-argument", "customerId is required.");
  const note = String(request.data?.note ?? "").trim();
  const statusOverrideRaw = request.data?.status == null || request.data?.status === "" ? "" : String(request.data.status).trim().toLowerCase();
  if (statusOverrideRaw && !STATUSES.has(statusOverrideRaw)) {
    throw new HttpsError("invalid-argument", "status must be active, grace, expired, or suspended.");
  }

  const hasDaysRemaining = request.data?.daysRemaining != null && request.data?.daysRemaining !== "";
  const hasAddDays = request.data?.addDays != null && request.data?.addDays !== "";
  const hasPaidUntil = request.data?.paidUntilMs != null && request.data?.paidUntilMs !== "";
  if (!hasDaysRemaining && !hasAddDays && !hasPaidUntil && !statusOverrideRaw) {
    throw new HttpsError("invalid-argument", "Provide daysRemaining, addDays, paidUntilMs, or status.");
  }

  const ref = db.collection("customers").doc(customerId);
  const now = Date.now();
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Customer not found.");
    const prevUntil = Number(snap.get("paidUntilMs") ?? 0);
    const currentStatus = String(snap.get("status") ?? "expired");
    let paidUntilMs: number | null = prevUntil > 0 ? prevUntil : null;

    if (hasPaidUntil) {
      const raw = Number(request.data.paidUntilMs);
      paidUntilMs = Number.isFinite(raw) && raw > 0 ? raw : null;
    } else if (hasDaysRemaining) {
      const days = Math.floor(Number(request.data.daysRemaining));
      if (!Number.isFinite(days) || days < 0) {
        throw new HttpsError("invalid-argument", "daysRemaining must be 0 or more.");
      }
      paidUntilMs = days === 0 ? null : now + days * DAY_MS;
    } else if (hasAddDays) {
      const addDays = Math.floor(Number(request.data.addDays));
      if (!Number.isFinite(addDays) || addDays === 0) {
        throw new HttpsError("invalid-argument", "addDays must be a non-zero integer.");
      }
      const base = prevUntil > now ? prevUntil : now;
      const next = base + addDays * DAY_MS;
      paidUntilMs = next > now ? next : null;
    }

    const left = remainingDays(paidUntilMs, now);
    let status = currentStatus;
    if (statusOverrideRaw) {
      status = statusOverrideRaw;
    } else if (currentStatus === "suspended") {
      status = "suspended";
    } else if (left <= 0) {
      status = "expired";
    } else if (currentStatus === "grace") {
      status = "grace";
    } else {
      status = "active";
    }

    let graceUntilMs: number | null = Number(snap.get("graceUntilMs") ?? 0) || null;
    if (status === "grace" && paidUntilMs) graceUntilMs = paidUntilMs;
    else if (status === "active" || status === "expired" || left <= 0) graceUntilMs = null;
    const daysGranted = hasAddDays ? Math.floor(Number(request.data.addDays)) : left;

    tx.update(ref, {
      paidUntilMs,
      status,
      graceUntilMs,
      updatedAtMs: now,
      updatedBy: owner.email,
    });
    tx.set(ref.collection("payments").doc(), {
      amount: 0,
      kind: "adjust",
      daysGranted,
      note,
      atMs: now,
      byUid: owner.uid,
    });
    return { paidUntilMs, status, daysRemaining: left };
  });

  await writeAudit({
    action: "adjust_subscription",
    adminEmail: owner.email,
    targetUid: customerId,
    detail: `left=${result.daysRemaining} status=${result.status} note=${note}`,
  });

  const customer = await ref.get();
  const left = result.daysRemaining;
  await sendToToken(
    customer.get("fcmToken") as string | undefined,
    "GlobalNetwork service updated",
    left > 0
      ? `Your internet service now has ${left} day${left === 1 ? "" : "s"} remaining.`
      : "Your internet subscription has no remaining days.",
    { type: "subscription", customerId },
  );
  return result;
});

export const unsuspendCustomer = onCall(CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const customerId = String(request.data?.customerId ?? "").trim();
  if (!customerId) throw new HttpsError("invalid-argument", "customerId is required.");
  const ref = db.collection("customers").doc(customerId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Customer not found.");
  const now = Date.now();
  const paidUntilMs = Number(snap.get("paidUntilMs") ?? 0);
  const graceUntilMs = Number(snap.get("graceUntilMs") ?? 0);
  const status = statusFromTimestamps(paidUntilMs, graceUntilMs, now);
  await ref.update({ status, updatedAtMs: now, updatedBy: owner.email });
  await writeAudit({ action: "unsuspend_customer", adminEmail: owner.email, targetUid: customerId, detail: status });
  await sendToToken(
    snap.get("fcmToken") as string | undefined,
    "GlobalNetwork service updated",
    status === "expired"
      ? "Your account is no longer suspended. Renew to get back on the network."
      : "Your account is no longer suspended.",
    { type: "subscription", customerId },
  );
  return { ok: true, status, paidUntilMs: paidUntilMs || null };
});

export const deletePlan = onCall(CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const id = String(request.data?.id ?? request.data?.planId ?? "").trim();
  if (!id) throw new HttpsError("invalid-argument", "Plan id is required.");
  const force = request.data?.force === true;
  const planRef = db.collection("plans").doc(id);
  const plan = await planRef.get();
  if (!plan.exists) throw new HttpsError("not-found", "Plan not found.");

  const assigned = await db.collection("customers").where("planId", "==", id).limit(1).get();
  if (!assigned.empty && !force) {
    throw new HttpsError("failed-precondition", "Customers are still on this plan. Confirm force unassign to delete.");
  }

  let unassigned = 0;
  if (force) {
    for (;;) {
      const snap = await db.collection("customers").where("planId", "==", id).limit(200).get();
      if (snap.empty) break;
      const batch = db.batch();
      for (const doc of snap.docs) {
        batch.update(doc.ref, { planId: "", planName: "", updatedAtMs: Date.now() });
      }
      await batch.commit();
      unassigned += snap.size;
    }
  }

  await planRef.delete();
  await writeAudit({
    action: "delete_plan",
    adminEmail: owner.email,
    targetUid: id,
    detail: force ? `force unassigned ${unassigned}` : String(plan.get("name") ?? id),
  });
  return { ok: true, unassigned };
});

export const deleteCustomer = onCall(CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const customerId = String(request.data?.customerId ?? "").trim();
  if (!customerId) throw new HttpsError("invalid-argument", "customerId is required.");
  const ref = db.collection("customers").doc(customerId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Customer not found.");
  const name = String(snap.get("name") ?? customerId);
  await db.recursiveDelete(ref);
  await writeAudit({ action: "delete_customer", adminEmail: owner.email, targetUid: customerId, detail: name });
  return { ok: true };
});

export const clearCustomerChat = onCall(CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const customerId = String(request.data?.customerId ?? "").trim();
  if (!customerId) throw new HttpsError("invalid-argument", "customerId is required.");
  const ref = db.collection("customers").doc(customerId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Customer not found.");
  const deleted = await clearChatFor(ref);
  await writeAudit({ action: "clear_customer_chat", adminEmail: owner.email, targetUid: customerId, detail: `${deleted} messages` });
  return { ok: true, deleted };
});

export const deleteChatMessage = onCall(CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const customerId = String(request.data?.customerId ?? "").trim();
  const messageId = String(request.data?.messageId ?? "").trim();
  if (!customerId || !messageId) throw new HttpsError("invalid-argument", "customerId and messageId are required.");
  const customerRef = db.collection("customers").doc(customerId);
  const msgRef = customerRef.collection("chatMessages").doc(messageId);
  const msg = await msgRef.get();
  if (!msg.exists) throw new HttpsError("not-found", "Message not found.");
  await msgRef.delete();
  await refreshLastChat(customerRef);
  await writeAudit({ action: "delete_chat_message", adminEmail: owner.email, targetUid: customerId, detail: messageId });
  return { ok: true };
});

export const updateChatMessage = onCall(CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const customerId = String(request.data?.customerId ?? "").trim();
  const messageId = String(request.data?.messageId ?? "").trim();
  const text = String(request.data?.text ?? "");
  if (!customerId || !messageId) throw new HttpsError("invalid-argument", "customerId and messageId are required.");
  const customerRef = db.collection("customers").doc(customerId);
  const msgRef = customerRef.collection("chatMessages").doc(messageId);
  const msg = await msgRef.get();
  if (!msg.exists) throw new HttpsError("not-found", "Message not found.");
  await msgRef.update({ text, editedAtMs: Date.now(), editedBy: owner.email });
  await refreshLastChat(customerRef);
  await writeAudit({ action: "update_chat_message", adminEmail: owner.email, targetUid: customerId, detail: messageId });
  return { ok: true };
});

export const deleteIssue = onCall(CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const customerId = String(request.data?.customerId ?? "").trim();
  const issueId = String(request.data?.issueId ?? "").trim();
  if (!customerId || !issueId) throw new HttpsError("invalid-argument", "customerId and issueId are required.");
  const ref = db.collection("customers").doc(customerId).collection("issues").doc(issueId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Issue not found.");
  await ref.delete();
  await writeAudit({ action: "delete_issue", adminEmail: owner.email, targetUid: customerId, detail: issueId });
  return { ok: true };
});

export const updateIssue = onCall(CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const customerId = String(request.data?.customerId ?? "").trim();
  const issueId = String(request.data?.issueId ?? "").trim();
  if (!customerId || !issueId) throw new HttpsError("invalid-argument", "customerId and issueId are required.");
  const ref = db.collection("customers").doc(customerId).collection("issues").doc(issueId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Issue not found.");
  const patch: Record<string, unknown> = { updatedAtMs: Date.now(), updatedBy: owner.email };
  if (request.data?.title != null) patch.title = String(request.data.title);
  if (request.data?.body != null) patch.body = String(request.data.body);
  if (request.data?.status != null && request.data.status !== "") {
    const status = String(request.data.status);
    if (status !== "open" && status !== "in_progress" && status !== "resolved") {
      throw new HttpsError("invalid-argument", "status must be open, in_progress, or resolved.");
    }
    patch.status = status;
  }
  await ref.update(patch);
  await writeAudit({ action: "update_issue", adminEmail: owner.email, targetUid: customerId, detail: issueId });
  return { ok: true };
});

export const deletePayment = onCall(CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const customerId = String(request.data?.customerId ?? "").trim();
  const paymentId = String(request.data?.paymentId ?? "").trim();
  if (!customerId || !paymentId) throw new HttpsError("invalid-argument", "customerId and paymentId are required.");
  const ref = db.collection("customers").doc(customerId).collection("payments").doc(paymentId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Payment not found.");
  await ref.delete();
  await writeAudit({ action: "delete_payment", adminEmail: owner.email, targetUid: customerId, detail: paymentId });
  return { ok: true };
});

export const factoryReset = onCall(
  { ...CALLABLE, timeoutSeconds: 300, memory: "512MiB" },
  async (request) => {
    const owner = await requireOwner(request);
    const phrase = String(request.data?.confirm ?? request.data?.phrase ?? "")
      .trim()
      .toUpperCase();
    if (phrase !== RESET_PHRASE) {
      throw new HttpsError("invalid-argument", 'Type RESET GLOBALNETWORK to confirm factory reset.');
    }

    const orgId = String(request.data?.orgId ?? DEFAULT_ORG_ID).trim() || DEFAULT_ORG_ID;
    const orgRef = db.collection("orgs").doc(orgId);
    const org = await orgRef.get();
    const ownerFields = {
      ownerEmail: org.get("ownerEmail") ?? owner.email,
      ownerUid: org.get("ownerUid") ?? owner.uid,
      ownerFcmToken: org.get("ownerFcmToken") ?? null,
    };

    const customersDeleted = await wipeQuery(db.collection("customers"), true);
    const plansDeleted = await wipeQuery(db.collection("plans"));
    const auditLogsDeleted = await wipeQuery(db.collection("adminAuditLogs"));
    const invitesDeleted = await wipeQuery(db.collection("deskInvites"));
    const adminConfigDeleted = await wipeQuery(db.collection("adminConfig"));

    const now = Date.now();
    for (const plan of DEFAULT_PLANS) {
      await db.collection("plans").doc(plan.id).set({ ...plan, orgId, createdAtMs: now });
    }

    await orgRef.set(
      {
        ...DEFAULT_ORG_SETTINGS,
        ...ownerFields,
        updatedAtMs: now,
        updatedBy: owner.email,
      },
      { merge: true },
    );

    await writeAudit({
      action: "factory_reset",
      adminEmail: owner.email,
      targetUid: orgId,
      detail: `customers=${customersDeleted} plans=${plansDeleted}`,
    });

    return {
      ok: true,
      customersDeleted,
      plansDeleted,
      auditLogsDeleted,
      invitesDeleted,
      adminConfigDeleted,
    };
  },
);

function isMediaChat(data: Record<string, unknown>): boolean {
  const kind = chatKind(data);
  return kind === "voice" || kind === "video" || kind === "call";
}

export const tidyDesk = onCall(TIDY_TIMEOUT, async (request) => {
  const owner = await requireOwner(request);
  const action = String(request.data?.action ?? "").trim();
  if (!TIDY_ACTIONS.has(action)) {
    throw new HttpsError("invalid-argument", "Unknown tidy action.");
  }
  requireTidyPhrase(action, String(request.data?.confirm ?? ""));
  const customerId = String(request.data?.customerId ?? "").trim();
  const olderThanDays = Math.max(1, Math.min(3650, Math.floor(Number(request.data?.olderThanDays ?? 30) || 30)));
  const cutoff = Date.now() - olderThanDays * DAY_MS;
  const now = Date.now();

  let deleted = 0;
  let scanned = 0;
  let customersDeleted = 0;
  let merged = 0;
  let detail = action;

  if (action === "purgeAuditLogs") {
    deleted = await wipeQuery(db.collection("adminAuditLogs"));
    detail = `${deleted} audit logs`;
  } else if (action === "clearAllChats") {
    const result = await mapCustomers(async (ref) => clearChatFor(ref));
    scanned = result.scanned;
    deleted = result.deleted;
    detail = `${deleted} messages across ${scanned} customers`;
  } else if (action === "deleteResolvedIssues") {
    const result = await mapCustomers(async (ref) => wipeQuery(ref.collection("issues").where("status", "==", "resolved")));
    scanned = result.scanned;
    deleted = result.deleted;
    detail = `${deleted} resolved issues`;
  } else if (action === "deleteAllIssues") {
    const result = await mapCustomers(async (ref) => wipeQuery(ref.collection("issues")));
    scanned = result.scanned;
    deleted = result.deleted;
    detail = `${deleted} issues`;
  } else if (action === "deleteOldChat") {
    if (customerId) {
      const ref = db.collection("customers").doc(customerId);
      const snap = await ref.get();
      if (!snap.exists) throw new HttpsError("not-found", "Customer not found.");
      scanned = 1;
      deleted = await wipeQuery(ref.collection("chatMessages").where("createdAtMs", "<", cutoff));
      await refreshLastChat(ref);
      detail = `${deleted} messages older than ${olderThanDays} days`;
    } else {
      const result = await mapCustomers(async (ref) => {
        const n = await wipeQuery(ref.collection("chatMessages").where("createdAtMs", "<", cutoff));
        if (n) await refreshLastChat(ref);
        return n;
      });
      scanned = result.scanned;
      deleted = result.deleted;
      detail = `${deleted} messages older than ${olderThanDays} days`;
    }
  } else if (action === "purgeCalls") {
    const result = await mapCustomers(async (ref) =>
      wipeMatching(
        ref.collection("calls"),
        (data) => {
          const status = String(data.status ?? "");
          return status === "ended" || status === "missed";
        },
        true,
      ),
    );
    scanned = result.scanned;
    deleted = result.deleted;
    detail = `${deleted} ended/missed calls`;
  } else if (action === "deleteMediaMessages") {
    const result = await mapCustomers(async (ref) => {
      const n = await wipeMatching(ref.collection("chatMessages"), isMediaChat);
      if (n) await refreshLastChat(ref);
      return n;
    });
    scanned = result.scanned;
    deleted = result.deleted;
    detail = `${deleted} voice/video/call messages`;
  } else if (action === "deleteRejectedCustomers") {
    const result = await mapCustomers(async (ref, data) => {
      if (!isStaleCustomer(data, now, olderThanDays)) return 0;
      await db.recursiveDelete(ref);
      customersDeleted += 1;
      return 1;
    });
    scanned = result.scanned;
    deleted = result.deleted;
    detail = `${deleted} stale/rejected customers`;
  } else if (action === "mergeDuplicateEmails") {
    const result = await mergeDuplicateEmails();
    scanned = result.scanned;
    deleted = result.deleted;
    customersDeleted = result.deleted;
    merged = result.merged;
    detail =
      merged === 0
        ? "No duplicate emails to merge"
        : `Merged ${merged} email group${merged === 1 ? "" : "s"}, removed ${deleted} extra record${deleted === 1 ? "" : "s"}`;
  }

  await writeAudit({
    action: `tidy_${action}`,
    adminEmail: owner.email,
    targetUid: customerId || "desk",
    detail,
  });

  return { ok: true, action, deleted, scanned, customersDeleted, merged, olderThanDays, detail };
});
