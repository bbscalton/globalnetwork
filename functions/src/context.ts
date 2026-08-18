import { getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
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
/** Unpaid day-extension rate billed onto balanceDue (XCD / EC$). */
export const DAY_EXTENSION_RATE_XCD = 6;

function firebaseApp() {
  return getApps().length ? getApp() : initializeApp();
}

export const db = getFirestore(firebaseApp());

export function requireAuth(request: CallableRequest): { uid: string; email: string } {
  const uid = request.auth?.uid;
  const email = (request.auth?.token?.email as string | undefined) ?? "";
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

export async function memberIsOwner(uid: string): Promise<boolean> {
  const snap = await db.collection("deskMembers").doc(uid).get();
  return snap.exists && String(snap.get("role") ?? "") === "owner";
}

export async function requireOwner(request: CallableRequest): Promise<{ uid: string; email: string }> {
  const user = requireAuth(request);
  if (isFounderEmail(user.email)) return user;
  const claim = (request.auth?.token as Record<string, unknown> | undefined)?.owner;
  if (claim === true) return user;
  if (await memberIsOwner(user.uid)) return user;
  throw new HttpsError("permission-denied", "Owner access required. Ask an approved owner to grant your desk role.");
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
