import { onCall, onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { requireAdmin, sendToToken, db } from "./context";

export const platformHealth = onRequest({ cors: true, invoker: "public", region: "us-central1" }, async (_req, res) => {
  const started = Date.now();
  try {
    await db.collection("plans").limit(1).get();
    res.json({
      ok: true,
      service: "globalnetwork-functions",
      latencyMs: Date.now() - started,
      atMs: Date.now(),
    });
  } catch (e) {
    logger.error(e);
    res.status(500).json({ ok: false, message: e instanceof Error ? e.message : "health failed" });
  }
});

export const adminSendTestFcm = onCall(async (request) => {
  const staff = await requireAdmin(request);
  const me = await db.collection("staffProfiles").doc(staff.uid).get();
  await sendToToken(me.get("fcmToken") as string | undefined, "GlobalNetwork TCD", "Test push from System tab", {
    type: "test",
  });
  return { ok: true };
});

export const adminGetStorageDump = onCall(async (request) => {
  await requireAdmin(request);
  const base = process.env.R2_MEDIA_PROXY_BASE_URL || "";
  if (!base) {
    return { objects: 0, bytes: 0, truncated: false, customers: {}, message: "R2_MEDIA_PROXY_BASE_URL not set" };
  }
  const res = await fetch(`${base.replace(/\/$/, "")}/storage-dump`);
  if (!res.ok) throw new Error(`R2 dump HTTP ${res.status}`);
  return res.json();
});
