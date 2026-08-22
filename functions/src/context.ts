import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, type DocumentSnapshot } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { logger } from "firebase-functions";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";

export { FieldValue };

export const CALLABLE = {
  region: "us-central1" as const,
  cors: true,
  invoker: "public" as const,
};

export const ADMIN_EMAIL = "neuereatec@gmail.com";
export const DEFAULT_ORG_ID = "globalnetwork";
export const CURRENCY = "XCD";
export const DAY_MS = 24 * 60 * 60 * 1000;
/** Unpaid day-extension rate billed onto extensionDue (XCD / EC$). Balance = planDue + extensionDue. */
export const DAY_EXTENSION_RATE_XCD = 6;
/** Antigua has no DST; AST = UTC−4. Used so “days left” rolls at local midnight. */
export const ANTIGUA_OFFSET_MS = -4 * 60 * 60 * 1000;

export type Ymd = { y: number; m: number; d: number };

/** Calendar Y/M/D in America/Antigua for an instant. */
export function antiguaParts(ms: number): Ymd {
  const shifted = new Date(ms + ANTIGUA_OFFSET_MS);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

/** End of that Antigua calendar day (23:59:59.999 AST). */
export function endOfAntiguaDay(parts: Ymd): number {
  return Date.UTC(parts.y, parts.m - 1, parts.d, 23, 59, 59, 999) - ANTIGUA_OFFSET_MS;
}

export function addAntiguaDays(parts: Ymd, days: number): Ymd {
  const utc = Date.UTC(parts.y, parts.m - 1, parts.d) + days * DAY_MS;
  const d = new Date(utc);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

/**
 * Days remaining by Antigua calendar date (not wall-clock 24h slices).
 * Same calendar day as paid-until still counts as 0 once the instant has passed;
 * before that, diff of calendar dates (grant day of N days → N on day 0, N−1 after local midnight).
 */
export function calendarDaysLeft(paidUntilMs: number | null | undefined, now = Date.now()): number {
  if (!paidUntilMs || !Number.isFinite(paidUntilMs) || paidUntilMs <= now) return 0;
  const a = antiguaParts(now);
  const b = antiguaParts(paidUntilMs);
  const diff = Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY_MS);
  return Math.max(0, diff);
}

/** Extend from the later of “now” or an existing paid-until, by whole Antigua calendar days ending EOD. */
export function paidUntilAfterGrant(prevUntilMs: number, days: number, now = Date.now(), stillActive = false): number {
  const baseParts =
    stillActive && prevUntilMs > now ? antiguaParts(prevUntilMs) : antiguaParts(now);
  return endOfAntiguaDay(addAntiguaDays(baseParts, days));
}

function firebaseApp() {
  return getApps().length ? getApp() : initializeApp();
}

export const db = getFirestore(firebaseApp());

export function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function requireAuth(request: CallableRequest): { uid: string; email: string } {
  const uid = request.auth?.uid;
  const email = normalizeEmail((request.auth?.token?.email as string | undefined) ?? "");
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  return { uid, email };
}

export function isFounderEmail(email: string | undefined | null): boolean {
  return (email ?? "").trim().toLowerCase() === ADMIN_EMAIL;
}

export function isOwnerEmail(email: string | undefined | null): boolean {
  return isFounderEmail(email);
}

export async function setOwnerClaim(uid: string, owner: boolean): Promise<void> {
  try {
    await getAuth(firebaseApp()).setCustomUserClaims(uid, owner ? { owner: true } : { owner: false });
  } catch (error) {
    logger.warn("setOwnerClaim failed", { uid, error });
  }
}

export type DeskStaffRole = "owner" | "manager" | "cashier";

export const STAFF_ROLES: DeskStaffRole[] = ["owner", "manager", "cashier"];

export function parseStaffRole(value: unknown, fallback: DeskStaffRole = "owner"): DeskStaffRole {
  const role = String(value ?? "").trim().toLowerCase();
  if (role === "owner" || role === "manager" || role === "cashier") return role;
  return fallback;
}

export async function memberDoc(uid: string) {
  return db.collection("deskMembers").doc(uid).get();
}

export async function memberIsOwner(uid: string): Promise<boolean> {
  const snap = await memberDoc(uid);
  return snap.exists && String(snap.get("role") ?? "") === "owner";
}

export async function deskMemberRole(uid: string): Promise<string> {
  const snap = await memberDoc(uid);
  return snap.exists ? String(snap.get("role") ?? "") : "";
}

export type StaffSession = { uid: string; email: string; role: DeskStaffRole; outletIds: string[] };

function outletIdsFrom(snap: DocumentSnapshot | null | undefined): string[] {
  const raw = snap?.get("outletIds");
  if (!Array.isArray(raw)) return [];
  return raw.map((id) => String(id).trim()).filter(Boolean);
}

export async function requireOwner(request: CallableRequest): Promise<StaffSession> {
  const staff = await requireStaff(request, ["owner"]);
  return staff;
}

export async function requireManager(request: CallableRequest): Promise<StaffSession> {
  return requireStaff(request, ["owner", "manager"]);
}

export async function requirePosStaff(request: CallableRequest): Promise<StaffSession> {
  return requireStaff(request, ["owner", "manager", "cashier"]);
}

export async function requireStaff(
  request: CallableRequest,
  allowed: DeskStaffRole[],
): Promise<StaffSession> {
  const user = requireAuth(request);
  const snap = await memberDoc(user.uid);
  const outletIds = outletIdsFrom(snap);
  if (isFounderEmail(user.email)) {
    if (!allowed.includes("owner")) {
      throw new HttpsError("permission-denied", "This action is not available for your desk role.");
    }
    return { ...user, role: "owner", outletIds };
  }
  const claim = (request.auth?.token as Record<string, unknown> | undefined)?.owner;
  const stored = String(snap.get("role") ?? "");
  const role: DeskStaffRole | "" =
    stored === "owner" || stored === "manager" || stored === "cashier"
      ? stored
      : claim === true
        ? "owner"
        : "";
  if (!role || !allowed.includes(role)) {
    throw new HttpsError(
      "permission-denied",
      allowed.includes("cashier")
        ? "Approved desk staff required. Ask an owner to assign cashier, manager, or owner."
        : "Owner access required. Ask an approved owner to grant your desk role.",
    );
  }
  return { ...user, role, outletIds };
}

export async function writeAudit(entry: {
  action: string;
  adminEmail: string;
  targetUid: string;
  detail?: string;
}): Promise<void> {
  await db.collection("adminAuditLogs").add({
    ...entry,
    atMs: Date.now(),
  });
}

export async function sendToToken(token: string | undefined, title: string, body: string, data: Record<string, string>): Promise<void> {
  if (!token) return;
  try {
    await getMessaging(firebaseApp()).send({
      token,
      notification: { title, body },
      data,
    });
  } catch (e) {
    logger.warn("FCM send failed", e);
  }
}

export async function ownerFcmToken(orgId = DEFAULT_ORG_ID): Promise<string | undefined> {
  const tokens = await ownerFcmTokens(orgId);
  return tokens[0];
}

export async function ownerFcmTokens(orgId = DEFAULT_ORG_ID): Promise<string[]> {
  const tokens = new Set<string>();
  const members = await db.collection("deskMembers").where("role", "==", "owner").get();
  for (const doc of members.docs) {
    const token = doc.get("fcmToken");
    if (typeof token === "string" && token) tokens.add(token);
  }
  const org = await db.collection("orgs").doc(orgId).get();
  const fallback = org.get("ownerFcmToken");
  if (typeof fallback === "string" && fallback) tokens.add(fallback);
  return [...tokens];
}

export async function sendToOwners(title: string, body: string, data: Record<string, string>): Promise<void> {
  const tokens = await ownerFcmTokens();
  await Promise.all(tokens.map((token) => sendToToken(token, title, body, data)));
}

export const DEFAULT_PLANS = [
  { id: "plan-15", name: "15-day", days: 15, feeAmount: 2200, currency: CURRENCY, active: true },
  { id: "plan-30", name: "30-day home", days: 30, feeAmount: 4000, currency: CURRENCY, active: true },
  { id: "plan-90", name: "90-day", days: 90, feeAmount: 10800, currency: CURRENCY, active: true },
];
