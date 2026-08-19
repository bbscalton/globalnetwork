import type { DocumentData, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { db } from "./context";

export function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function customerKeepScore(data: DocumentData): number {
  const approved = String(data.approvalStatus ?? "") === "approved" ? 10_000 : 0;
  const paid = Number(data.paidUntilMs ?? 0) > 0 ? 1_000 : 0;
  const plan = String(data.planId ?? data.planName ?? "").trim() ? 100 : 0;
  const uid = String(data.uid ?? "").trim() ? 10 : 0;
  return approved + paid + plan + uid;
}

export function pickCustomerKeeper(docs: QueryDocumentSnapshot[]): QueryDocumentSnapshot {
  return [...docs].sort((a, b) => {
    const diff = customerKeepScore(b.data()) - customerKeepScore(a.data());
    if (diff) return diff;
    return Number(a.get("createdAtMs") ?? 0) - Number(b.get("createdAtMs") ?? 0);
  })[0];
}

export async function customersWithEmail(email: string): Promise<QueryDocumentSnapshot[]> {
  const key = normalizeEmail(email);
  if (!key) return [];
  const snap = await db.collection("customers").where("email", "==", key).get();
  return snap.docs;
}

export async function customerByUid(uid: string): Promise<QueryDocumentSnapshot | null> {
  if (!uid) return null;
  const snap = await db.collection("customers").where("uid", "==", uid).limit(1).get();
  return snap.empty ? null : snap.docs[0];
}

function nameLooksWeak(name: unknown, email: string): boolean {
  const n = String(name ?? "").trim();
  if (!n) return true;
  const local = (email.split("@")[0] || "").replace(/[._]/g, " ");
  return n.toLowerCase() === local.toLowerCase();
}

export function absorbPatch(keeper: DocumentData, extra: DocumentData): Record<string, unknown> {
  const email = normalizeEmail(keeper.email || extra.email);
  const patch: Record<string, unknown> = { email, updatedAtMs: Date.now() };
  if (!String(keeper.uid ?? "").trim() && String(extra.uid ?? "").trim()) patch.uid = extra.uid;
  if (!String(keeper.planId ?? "").trim() && String(extra.planId ?? extra.planName ?? "").trim()) {
    patch.planId = extra.planId ?? "";
    patch.planName = extra.planName ?? "";
    patch.planDays = extra.planDays ?? 0;
    patch.feeAmount = extra.feeAmount ?? 0;
  }
  if (Number(extra.paidUntilMs ?? 0) > Number(keeper.paidUntilMs ?? 0)) {
    patch.paidUntilMs = extra.paidUntilMs;
    patch.status = extra.status ?? keeper.status;
    patch.graceUntilMs = extra.graceUntilMs ?? null;
  }
  if (!String(keeper.phone ?? "").trim() && String(extra.phone ?? "").trim()) patch.phone = extra.phone;
  if (!String(keeper.address ?? "").trim() && String(extra.address ?? "").trim()) patch.address = extra.address;
  if (nameLooksWeak(keeper.name, email) && String(extra.name ?? "").trim()) patch.name = extra.name;
  if (!keeper.fcmToken && extra.fcmToken) patch.fcmToken = extra.fcmToken;
  if (Number(extra.lastSeenMs ?? 0) > Number(keeper.lastSeenMs ?? 0)) patch.lastSeenMs = extra.lastSeenMs;
  return patch;
}

const SUBCOLLECTIONS = ["chatMessages", "payments", "issues", "calls"] as const;

export async function absorbCustomer(
  keeper: QueryDocumentSnapshot,
  extra: QueryDocumentSnapshot,
): Promise<void> {
  const patch = absorbPatch(keeper.data(), extra.data());
  await keeper.ref.update(patch);
  for (const name of SUBCOLLECTIONS) {
    const sub = await extra.ref.collection(name).get();
    for (const doc of sub.docs) {
      await keeper.ref.collection(name).doc(doc.id).set(doc.data(), { merge: true });
    }
  }
  await db.recursiveDelete(extra.ref);
}
