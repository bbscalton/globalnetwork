import { onCall, onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { ownerFcmToken, requireOwner, sendToToken, db, CALLABLE } from "./context";

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

export const adminSendTestFcm = onCall(CALLABLE, async (request) => {
  await requireOwner(request);
  await sendToToken(await ownerFcmToken(), "GlobalNetwork", "Test push from the owner desk", {
    type: "test",
  });
  return { ok: true };
});

export const adminGetStorageDump = onCall(CALLABLE, async (request) => {
  await requireOwner(request);
  const base = process.env.R2_MEDIA_PROXY_BASE_URL || "";
  if (!base) {
    return { objects: 0, bytes: 0, truncated: false, customers: {}, message: "R2_MEDIA_PROXY_BASE_URL not set" };
  }
  const header = request.rawRequest?.headers?.authorization;
  const authorization = Array.isArray(header) ? header[0] : header;
  const res = await fetch(`${base.replace(/\/$/, "")}/storage-dump`, {
    headers: authorization ? { authorization } : {},
  });
  if (!res.ok) throw new Error(`R2 dump HTTP ${res.status}`);
  return res.json();
});
