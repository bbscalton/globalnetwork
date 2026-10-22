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
