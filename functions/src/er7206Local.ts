import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE, db, requireOwner, writeAudit } from "./context";
import { enqueueEr7206Action, enqueueEr7206Create, enqueueEr7206Enable } from "./er7206Queue";

const CONFIG_REF = db.collection("adminConfig").doc("er7206Local");
const LOCAL_CALLABLE = { ...CALLABLE, timeoutSeconds: 60 as const };

type LocalConfig = {
  connectorUrl: string;
  connectorToken?: string;
};

async function readConfig(): Promise<LocalConfig> {
  const snap = await CONFIG_REF.get();
  const raw = (snap.data() || {}) as Record<string, unknown>;
  return {
    connectorUrl: String(raw.connectorUrl || "").trim(),
    connectorToken: String(raw.connectorToken || "").trim() || undefined,
  };
}

async function connectorFetch(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const cfg = await readConfig();
  if (!cfg.connectorUrl) throw new HttpsError("failed-precondition", "Save the VPS connector URL first.");
  const url = cfg.connectorUrl.replace(/\/$/, "") + path;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (cfg.connectorToken) headers.Authorization = `Bearer ${cfg.connectorToken}`;
  if (init?.body) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers as object) } });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new HttpsError("internal", String(data.error || `connector HTTP ${res.status}`));
  return data;
}

export const saveEr7206LocalConfig = onCall(LOCAL_CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const connectorUrl = String(request.data?.connectorUrl ?? "").trim();
  if (!connectorUrl) throw new HttpsError("invalid-argument", "connectorUrl required");
  const patch: Record<string, unknown> = {
    connectorUrl,
    updatedAtMs: Date.now(),
    updatedBy: owner.email,
  };
  const token = String(request.data?.connectorToken ?? "").trim();
  if (token) patch.connectorToken = token;
  await CONFIG_REF.set(patch, { merge: true });
  await writeAudit({ action: "er7206_local_config_save", adminEmail: owner.email, targetUid: "er7206Local", detail: connectorUrl });
  return { ok: true };
});

export const er7206LocalStatus = onCall(LOCAL_CALLABLE, async (request) => {
  await requireOwner(request);
  const cfg = await readConfig();
  if (!cfg.connectorUrl) {
    return {
      ok: true,
      connected: false,
      connectorUrl: "",
      mode: "unconfigured",
      routerPassConfigured: false,
      userCount: 0,
    };
  }
  try {
    const health = await connectorFetch("/health");
    let userCount = 0;
    try {
      const users = await connectorFetch("/users");
      userCount = Number(users.count || (Array.isArray(users.users) ? users.users.length : 0) || 0);
    } catch {
      /* health alone is enough */
    }
    return {
      ok: true,
      connected: true,
      connectorUrl: cfg.connectorUrl,
      mode: String(health.mode || "unknown"),
      routerPassConfigured: !!health.router_pass_configured,
      userCount,
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: true,
      connected: false,
      connectorUrl: cfg.connectorUrl,
      mode: "error",
      routerPassConfigured: false,
      userCount: 0,
      error: message,
    };
  }
});

export const er7206LocalListUsers = onCall(LOCAL_CALLABLE, async (request) => {
  await requireOwner(request);
  const data = await connectorFetch("/users");
  return { ok: true, users: data.users || [] };
});

/**
 * Desk Block / Unblock (ER7206 page and customer page). Queues a router job for the VPS worker,
 * same path as auto-expiry: block = GN-Blocked slot (fallback enable=off); unblock = reset slot + enable=on
 * with expiry = desk paidUntil (never shortened; refused by the worker if not paid or suspended).
 * Accepts userName (router user) or customerId; the router user must be linked to exactly one customer.
 */
export const er7206LocalSetUserEnable = onCall(LOCAL_CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  let userName = String(request.data?.userName ?? "").trim();
  let customerId = String(request.data?.customerId ?? "").trim();
  const enable = !!request.data?.enable;
  if (!userName && !customerId) throw new HttpsError("invalid-argument", "userName or customerId required");
  if (!customerId) {
    const q = await db.collection("customers").where("er7206UserName", "==", userName).limit(2).get();
    if (q.size !== 1) {
      throw new HttpsError("failed-precondition", q.size ? `Router user ${userName} is linked to more than one customer` : `Link router user ${userName} to a customer first`);
    }
    customerId = q.docs[0].id;
  }
  const snap = await db.collection("customers").doc(customerId).get();
  if (!snap.exists) throw new HttpsError("not-found", "Customer not found");
  userName = String(snap.get("er7206UserName") ?? "").trim();
  if (!userName) throw new HttpsError("failed-precondition", "Customer has no linked router user");
  let jobId: string | null;
  if (enable) {
    const pu = Number(snap.get("paidUntilMs") ?? 0);
    if (!(pu > Date.now())) throw new HttpsError("failed-precondition", "Desk shows no paid time; add days or take payment to unblock.");
    if (String(snap.get("status") ?? "") === "suspended") throw new HttpsError("failed-precondition", "Customer is suspended; use Unsuspend.");
    jobId = await enqueueEr7206Enable(customerId, 0, pu, "deskUnblock");
  } else {
    jobId = await enqueueEr7206Action(customerId, "block", "deskBlock");
  }
  await writeAudit({
    action: enable ? "er7206_local_unblock" : "er7206_local_block",
    adminEmail: owner.email,
    targetUid: customerId,
    detail: userName,
  });
  return { ok: !!jobId, queued: true, routerJobId: jobId, userName };
});

export const er7206LocalDryRun = onCall(LOCAL_CALLABLE, async (request) => {
  await requireOwner(request);
  const snap = await db.collection("adminConfig").doc("er7206LocalReview").get();
  if (snap.exists) {
    const data = snap.data() || {};
    return {
      ok: true,
      source: "firestore",
      review: data.review || [],
      unmatched_router: data.unmatched_router || [],
      matched: data.matched || [],
      counts: data.counts || {},
      updatedAtMs: data.updatedAtMs || null,
      notes: data.notes || [],
    };
  }
  try {
    const live = await connectorFetch("/dry-run");
    return { ...live, source: "connector" };
  } catch {
    return { ok: true, source: "empty", review: [], unmatched_router: [], matched: [], counts: {} };
  }
});

/** Manual link only — never creates customers. Stores er7206UserName + cpeMac. */
export const er7206LocalLinkCustomer = onCall(LOCAL_CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const customerId = String(request.data?.customerId ?? "").trim();
  const userName = String(request.data?.userName ?? "").trim();
  const mac = String(request.data?.mac ?? "").trim();
  if (!customerId || !userName) throw new HttpsError("invalid-argument", "customerId and userName required");
  const ref = db.collection("customers").doc(customerId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Customer not found");
  // Must be an existing router user from the latest VPS sync (adminConfig/er7206LocalReview).
  const review = (await db.collection("adminConfig").doc("er7206LocalReview").get()).data() || {};
  const known = new Set<string>();
  for (const key of ["review", "unmatched_router", "matched"]) {
    for (const row of (Array.isArray(review[key]) ? review[key] : []) as Array<Record<string, any>>) {
      for (const n of [row?.routerUserName, row?.user?.userName, row?.user?.[".name"]]) {
        if (typeof n === "string" && n.trim()) known.add(n.trim());
      }
    }
  }
  if (!known.has(userName)) {
    throw new HttpsError("failed-precondition", `Router user "${userName}" is not on the ER7206 (latest sync has ${known.size} users). Pick one from the list.`);
  }
  const taken = await db.collection("customers").where("er7206UserName", "==", userName).limit(2).get();
  if (taken.docs.some((d) => d.id !== customerId)) {
    throw new HttpsError("failed-precondition", `Router user "${userName}" is already linked to another customer.`);
  }
  const patch: Record<string, unknown> = {
    er7206UserName: userName,
    updatedAtMs: Date.now(),
  };
  const hex = mac.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  if (hex.length === 12) {
    const pretty = hex.match(/.{2}/g)!.join("-");
    patch.cpeMac = pretty;
    patch.omadaClientMac = pretty;
  }
  const prevUser = String(snap.get("er7206UserName") ?? "").trim();
  await ref.update(patch);
  await writeAudit({
    action: "er7206_local_link",
    adminEmail: owner.email,
    targetUid: customerId,
    detail: userName,
  });
  // Push desk state to the router: enable if paid, block if expired/suspended.
  const routerJobId = prevUser !== userName ? await enqueueEr7206Action(customerId, "sync", "er7206LocalLinkCustomer") : null;
  return { ok: true, routerJobId };
});

/** Create a NEW router local user for an existing customer (queued to the VPS worker). Owner only. */
export const er7206CreateRouterUser = onCall(LOCAL_CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const customerId = String(request.data?.customerId ?? "").trim();
  const userName = String(request.data?.userName ?? "").trim();
  if (!customerId || !userName) throw new HttpsError("invalid-argument", "customerId and userName required");
  let jobId: string;
  try {
    jobId = await enqueueEr7206Create({
      customerId,
      username: userName,
      password: String(request.data?.password ?? ""),
      mac: String(request.data?.mac ?? ""),
      source: "er7206CreateRouterUser",
    });
  } catch (e) {
    throw new HttpsError("failed-precondition", e instanceof Error ? e.message : String(e));
  }
  await writeAudit({ action: "er7206_create_user", adminEmail: owner.email, targetUid: customerId, detail: userName });
  return { ok: true, routerJobId: jobId };
});


/**
 * Desk speed control: queue a per-user rate limit on the router local user (upBand/downBand,
 * same get-then-set path as enable/expiry; 0 = no limit, else 10..1000000). Owner only.
 * action "throttle" needs upBand + downBand; "restore" sets both back to 0 (full speed).
 */
export const er7206SetSpeed = onCall(LOCAL_CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const customerId = String(request.data?.customerId ?? "").trim();
  const action = String(request.data?.action ?? "").trim();
  if (!customerId || (action !== "throttle" && action !== "restore")) {
    throw new HttpsError("invalid-argument", "customerId and action throttle|restore required");
  }
  const band = (v: unknown) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || !(n === 0 || (n >= 10 && n <= 1000000))) {
      throw new HttpsError("invalid-argument", "Bandwidth must be 0 or 10..1000000");
    }
    return String(n);
  };
  const upBand = action === "throttle" ? band(request.data?.upBand) : "0";
  const downBand = action === "throttle" ? band(request.data?.downBand) : "0";
  const snap = await db.collection("customers").doc(customerId).get();
  if (!snap.exists) throw new HttpsError("not-found", "Customer not found");
  const username = String(snap.get("er7206UserName") ?? "").trim();
  if (!username) throw new HttpsError("failed-precondition", "Customer is not linked to a router user");
  const ref = db.collection("er7206Queue").doc();
  await ref.set({
    action, customerId, username, upBand, downBand,
    status: "pending", createdAtMs: Date.now(), source: "er7206SetSpeed",
  });
  await writeAudit({ action: `er7206_${action}`, adminEmail: owner.email, targetUid: customerId,
    detail: `${username} up=${upBand} down=${downBand}` });
  return { ok: true, routerJobId: ref.id };
});

const REVIEW_REF = db.collection("adminConfig").doc("er7206LocalReview");

/** VPS connector ingest: review list + optional confident customer patches. Never creates customers. */
export const er7206ConnectorIngest = onRequest(
  { region: "us-central1", cors: true, invoker: "public", timeoutSeconds: 120 },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "POST only" });
      return;
    }
    const cfg = await readConfig();
    const token = cfg.connectorToken || "";
    const auth = String(req.headers.authorization || "");
    if (!token || auth !== `Bearer ${token}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const body = (req.body || {}) as Record<string, unknown>;
    const review = Array.isArray(body.review) ? body.review : [];
    const unmatched = Array.isArray(body.unmatched_router) ? body.unmatched_router : [];
    const matched = Array.isArray(body.matched) ? body.matched : [];
    const counts = (body.counts && typeof body.counts === "object") ? body.counts : {};
    const notes = Array.isArray(body.notes) ? body.notes : [];

    await REVIEW_REF.set(
      {
        review,
        unmatched_router: unmatched,
        matched,
        counts,
        notes,
        updatedAtMs: Date.now(),
        source: "connector-timer",
      },
      { merge: false },
    );

    const applied: string[] = [];
    const applyList = Array.isArray(body.apply) ? body.apply : [];
    for (const item of applyList) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const customerId = String(row.customerId || "").trim();
      const patch = (row.patch && typeof row.patch === "object") ? (row.patch as Record<string, unknown>) : null;
      if (!customerId || !patch) continue;
      const ref = db.collection("customers").doc(customerId);
      const snap = await ref.get();
      if (!snap.exists) continue; // never create
      const allowed: Record<string, unknown> = { updatedAtMs: Date.now() };
      for (const k of ["paidUntilMs", "planName", "planDays", "feeAmount", "status", "er7206UserName", "cpeMac", "omadaClientMac"]) {
        if (k in patch) allowed[k] = patch[k];
      }
      if (typeof allowed.paidUntilMs === "string" && /^\d+$/.test(allowed.paidUntilMs as string)) {
        allowed.paidUntilMs = Number(allowed.paidUntilMs);
      }
      await ref.update(allowed);
      applied.push(customerId);
    }

    res.json({ ok: true, review: review.length, unmatched: unmatched.length, applied: applied.length, appliedIds: applied });
  },
);
