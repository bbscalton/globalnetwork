import { onCall, onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { ownerFcmToken, requireOwner, sendToToken, db, CALLABLE, ANTIGUA_TZ } from "./context";

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

/**
 * Server time endpoint for client clock skew correction.
 * Returns server timestamp so clients can compute (serverTime - clientTime) offset.
 */
export const serverTime = onRequest({ cors: true, invoker: "public", region: "us-central1" }, async (_req, res) => {
  const now = Date.now();
  res.json({
    serverTimeMs: now,
    timezone: ANTIGUA_TZ,
    isoUtc: new Date(now).toISOString(),
  });
});

/**
 * App version check endpoint.
 * Returns minimum required version and whether an update is available.
 * Clients send their current version and receive update guidance.
 */
export const checkAppVersion = onRequest({ cors: true, invoker: "public", region: "us-central1" }, async (req, res) => {
  // Get version config from adminConfig or use defaults
  const config = await db.collection("adminConfig").doc("appVersions").get();
  const minAndroidVersion = config.exists ? Number(config.get("minAndroidVersion") ?? 15) : 15;
  const minIosVersion = config.exists ? Number(config.get("minIosVersion") ?? 15) : 15;
  const latestAndroidVersion = config.exists ? Number(config.get("latestAndroidVersion") ?? 15) : 15;
  const latestIosVersion = config.exists ? Number(config.get("latestIosVersion") ?? 15) : 15;
  const updateMessage = config.exists ? String(config.get("updateMessage") ?? "") : "";
  
  // Parse client version from query or body
  const clientVersion = Number(req.query.version ?? req.body?.version ?? 0);
  const platform = String(req.query.platform ?? req.body?.platform ?? "android").toLowerCase();
  
  const minVersion = platform === "ios" ? minIosVersion : minAndroidVersion;
  const latestVersion = platform === "ios" ? latestIosVersion : latestAndroidVersion;
  
  const updateRequired = clientVersion > 0 && clientVersion < minVersion;
  const updateAvailable = clientVersion > 0 && clientVersion < latestVersion;
  
  res.json({
    ok: true,
    clientVersion,
    platform,
    minVersion,
    latestVersion,
    updateRequired,
    updateAvailable,
    updateMessage: updateRequired || updateAvailable ? (updateMessage || "A new version of GlobalNetwork is available.") : "",
    downloadUrl: platform === "ios" 
      ? "https://globalnetwork-media.neuereatec.workers.dev/app/ios.ipa"
      : "https://globalnetwork-media.neuereatec.workers.dev/app/android.apk",
  });
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
