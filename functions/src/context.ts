import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";

export const ADMIN_EMAIL = "neuereatec@gmail.com";
export const DEFAULT_ORG_ID = "globalnetwork";
export const DAY_MS = 24 * 60 * 60 * 1000;

if (!admin.apps.length) {
  admin.initializeApp();
}

export const db = admin.firestore();

export function requireAuth(request: CallableRequest): { uid: string; email: string } {
  const uid = request.auth?.uid;
  const email = (request.auth?.token?.email as string | undefined) ?? "";
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  return { uid, email };
}

export async function requireStaff(request: CallableRequest): Promise<{ uid: string; email: string; admin: boolean }> {
  const user = requireAuth(request);
  const adminUser = user.email.trim().toLowerCase() === ADMIN_EMAIL;
  if (adminUser) return { ...user, admin: true };
  const staff = await db.collection("staffProfiles").doc(user.uid).get();
  if (!staff.exists || staff.get("blocked") === true) {
    throw new HttpsError("permission-denied", "Staff access required.");
  }
  return { ...user, admin: false };
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
    await admin.messaging().send({
      token,
      notification: { title, body },
      data,
    });
  } catch (e) {
    logger.warn("FCM send failed", e);
  }
}

export const DEFAULT_PLANS = [
  { id: "plan-15", name: "15-day", days: 15, feeAmount: 2200, currency: "GYD", active: true },
  { id: "plan-30", name: "30-day home", days: 30, feeAmount: 4000, currency: "GYD", active: true },
  { id: "plan-90", name: "90-day", days: 90, feeAmount: 10800, currency: "GYD", active: true },
];
