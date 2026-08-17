import { getApp, getApps, initializeApp } from "firebase-admin/app";
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

export function isOwnerEmail(email: string | undefined | null): boolean {
  return (email ?? "").trim().toLowerCase() === ADMIN_EMAIL;
}

export async function requireOwner(request: CallableRequest): Promise<{ uid: string; email: string }> {
  const user = requireAuth(request);
  if (!isOwnerEmail(user.email)) {
    throw new HttpsError("permission-denied", "Owner access required.");
  }
  return user;
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
  const snap = await db.collection("orgs").doc(orgId).get();
  const token = snap.get("ownerFcmToken");
  return typeof token === "string" && token ? token : undefined;
}

export const DEFAULT_PLANS = [
  { id: "plan-15", name: "15-day", days: 15, feeAmount: 2200, currency: CURRENCY, active: true },
  { id: "plan-30", name: "30-day home", days: 30, feeAmount: 4000, currency: CURRENCY, active: true },
  { id: "plan-90", name: "90-day", days: 90, feeAmount: 10800, currency: CURRENCY, active: true },
];
