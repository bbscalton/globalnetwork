import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE, db, requireOwner, writeAudit } from "./context";

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
  await writeAudit({ action: "er7206_local_config_save", adminEmail: owner.email, detail: connectorUrl });
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

/** Operator click only. Connector refuses until ENABLE_WRITES=1. */
export const er7206LocalSetUserEnable = onCall(LOCAL_CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const userName = String(request.data?.userName ?? "").trim();
  const key = String(request.data?.key ?? "").trim();
  const enable = !!request.data?.enable;
  if (!userName) throw new HttpsError("invalid-argument", "userName required");
  const data = await connectorFetch("/users/set-enable", {
    method: "POST",
    body: JSON.stringify({ userName, key, enable }),
  });
  await writeAudit({
    action: enable ? "er7206_local_unblock" : "er7206_local_block",
    adminEmail: owner.email,
    detail: userName,
  });
  return data;
});


export const er7206LocalDryRun = onCall(LOCAL_CALLABLE, async (request) => {
  await requireOwner(request);
  return connectorFetch("/dry-run");
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
  await ref.update(patch);
  await writeAudit({
    action: "er7206_local_link",
    adminEmail: owner.email,
    targetUid: customerId,
    detail: userName,
  });
  return { ok: true };
});
