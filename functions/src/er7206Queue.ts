import { logger } from "firebase-functions";
import { db } from "./context";

/** Router expiry date (MM/DD/YYYY) in the router's local zone. */
const ROUTER_TZ = "America/Guyana";

export function routerExpireDate(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ROUTER_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")}/${get("day")}/${get("year")}`;
}

/**
 * After a successful paidUntilMs increase: queue a router enable + expiry job for the
 * VPS connector. Linked customers only (er7206UserName). Never throws to the caller.
 */
export async function enqueueEr7206Enable(
  customerId: string,
  prevUntilMs: number | null | undefined,
  newUntilMs: number | null | undefined,
  source: string,
): Promise<string | null> {
  try {
    const next = Number(newUntilMs ?? 0);
    const prev = Number(prevUntilMs ?? 0);
    const now = Date.now();
    if (!customerId || !Number.isFinite(next) || next <= now || next <= prev) return null;
    const snap = await db.collection("customers").doc(customerId).get();
    if (!snap.exists) return null;
    const username = String(snap.get("er7206UserName") ?? "").trim();
    if (!username) return null;
    const ref = db.collection("er7206Queue").doc();
    await ref.set({
      customerId,
      username,
      enable: true,
      expire: routerExpireDate(next),
      paidUntilMs: next,
      prevPaidUntilMs: prev || null,
      status: "pending",
      createdAtMs: now,
      source,
    });
    logger.info("er7206 queue enqueued", { id: ref.id, customerId, username, source });
    return ref.id;
  } catch (e) {
    logger.error("er7206 queue enqueue failed", { customerId, source, error: String(e) });
    return null;
  }
}

/**
 * Queue a router block / sync job for a linked customer (desk Suspend, Link). Never throws.
 * block: worker blocks like auto-expiry (GN-Blocked slot, else enable=off).
 * sync:  worker enables (expiry = desk paidUntil, never shortened) if paid, else blocks.
 */
export async function enqueueEr7206Action(
  customerId: string,
  action: "block" | "sync",
  source: string,
): Promise<string | null> {
  try {
    if (!customerId) return null;
    const snap = await db.collection("customers").doc(customerId).get();
    if (!snap.exists) return null;
    const username = String(snap.get("er7206UserName") ?? "").trim();
    if (!username) return null;
    const pu = Number(snap.get("paidUntilMs") ?? 0);
    const ref = db.collection("er7206Queue").doc();
    await ref.set({
      action,
      customerId,
      username,
      enable: action === "sync" ? null : false,
      expire: action === "sync" && pu > Date.now() ? routerExpireDate(pu) : null,
      paidUntilMs: pu || null,
      status: "pending",
      createdAtMs: Date.now(),
      source,
    });
    logger.info("er7206 queue enqueued", { id: ref.id, customerId, username, action, source });
    return ref.id;
  } catch (e) {
    logger.error("er7206 queue enqueue failed", { customerId, action, source, error: String(e) });
    return null;
  }
}

export const ROUTER_USER_RE = /^[A-Za-z0-9_.-]{3,32}$/;

/**
 * Queue creation of a NEW router local user. The password goes only into er7206Secrets/{jobId}
 * (no client access in rules; the VPS worker deletes it after use). Throws on bad input.
 */
export async function enqueueEr7206Create(input: {
  customerId: string;
  username: string;
  password: string;
  mac?: string;
  note?: string;
  source: string;
}): Promise<string> {
  const username = input.username.trim();
  if (!ROUTER_USER_RE.test(username)) throw new Error("Router username: 3-32 letters, digits, . _ -");
  if (!input.password || input.password.length < 4 || input.password.length > 64) {
    throw new Error("Router password: 4-64 characters");
  }
  const snap = await db.collection("customers").doc(input.customerId).get();
  if (!snap.exists) throw new Error("Customer not found");
  const linked = String(snap.get("er7206UserName") ?? "").trim();
  if (linked && linked !== username) throw new Error(`Customer already linked to router user ${linked}`);
  const pu = Number(snap.get("paidUntilMs") ?? 0);
  const ref = db.collection("er7206Queue").doc();
  await db.collection("er7206Secrets").doc(ref.id).set({ password: input.password, createdAtMs: Date.now() });
  await ref.set({
    action: "create",
    customerId: input.customerId,
    username,
    mac: String(input.mac ?? "").trim(),
    note: String(input.note ?? "").trim().slice(0, 30),
    planName: String(snap.get("planName") ?? ""),
    expire: routerExpireDate(pu > Date.now() ? pu : Date.now()),
    paidUntilMs: pu || null,
    status: "pending",
    createdAtMs: Date.now(),
    source: input.source,
  });
  logger.info("er7206 create enqueued", { id: ref.id, customerId: input.customerId, username, source: input.source });
  return ref.id;
}
