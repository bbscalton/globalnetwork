import * as crypto from "crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE, db, requireOwner, writeAudit } from "./context";

const CONFIG_REF = db.collection("adminConfig").doc("quickbooksOnline");
const QBO_CALLABLE = { ...CALLABLE, timeoutSeconds: 60 as const };

/** Must match the Redirect URI registered on the Intuit developer app. */
export const DEFAULT_QBO_REDIRECT_URI = "https://bbscalton.github.io/globalnetwork/ops/";
const AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const SCOPE = "com.intuit.quickbooks.accounting";
const STATE_TTL_MS = 15 * 60 * 1000;

export type QboEnvironment = "sandbox" | "production";

export type QboPublicStatus = {
  clientId: string;
  clientSecretSaved: boolean;
  clientSecretLast4: string;
  environment: QboEnvironment;
  redirectUri: string;
  scope: string;
  connected: boolean;
  realmId: string;
  companyName: string;
  connectedAtMs: number;
  tokenExpiresAtMs: number;
  exportReady: boolean;
};

type QboSecretConfig = {
  clientId: string;
  clientSecret: string;
  clientSecretLast4: string;
  environment: QboEnvironment;
  redirectUri: string;
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  accessTokenExpiresAtMs: number;
  refreshTokenExpiresAtMs: number;
  realmId: string;
  companyName: string;
  connectedAtMs: number;
  connectedBy: string;
  oauthStates: Record<string, { email: string; createdAtMs: number; expiresAtMs: number }>;
};

function last4(secret: string): string {
  const t = secret.trim();
  if (!t) return "";
  return t.length <= 4 ? t : t.slice(-4);
}

function asEnv(value: unknown, fallback: QboEnvironment = "sandbox"): QboEnvironment {
  return String(value ?? "").trim().toLowerCase() === "production" ? "production" : fallback;
}

function secretFrom(data: Record<string, unknown> | undefined): QboSecretConfig {
  const d = data ?? {};
  const oauthStates =
    d.oauthStates && typeof d.oauthStates === "object" && !Array.isArray(d.oauthStates)
      ? (d.oauthStates as QboSecretConfig["oauthStates"])
      : {};
  return {
    clientId: String(d.clientId ?? "").trim(),
    clientSecret: String(d.clientSecret ?? ""),
    clientSecretLast4: String(d.clientSecretLast4 ?? ""),
    environment: asEnv(d.environment),
    redirectUri: String(d.redirectUri ?? "").trim() || DEFAULT_QBO_REDIRECT_URI,
    accessToken: String(d.accessToken ?? ""),
    refreshToken: String(d.refreshToken ?? ""),
    tokenType: String(d.tokenType ?? "bearer"),
    accessTokenExpiresAtMs: Number(d.accessTokenExpiresAtMs ?? 0) || 0,
    refreshTokenExpiresAtMs: Number(d.refreshTokenExpiresAtMs ?? 0) || 0,
    realmId: String(d.realmId ?? "").trim(),
    companyName: String(d.companyName ?? "").trim(),
    connectedAtMs: Number(d.connectedAtMs ?? 0) || 0,
    connectedBy: String(d.connectedBy ?? ""),
    oauthStates,
  };
}

function publicFrom(cfg: QboSecretConfig): QboPublicStatus {
  const connected = Boolean(cfg.accessToken && cfg.refreshToken && cfg.realmId);
  return {
    clientId: cfg.clientId,
    clientSecretSaved: Boolean(cfg.clientSecret.trim()),
    clientSecretLast4: cfg.clientSecretLast4 || last4(cfg.clientSecret),
    environment: cfg.environment,
    redirectUri: cfg.redirectUri || DEFAULT_QBO_REDIRECT_URI,
    scope: SCOPE,
    connected,
    realmId: connected ? cfg.realmId : "",
    companyName: connected ? cfg.companyName : "",
    connectedAtMs: connected ? cfg.connectedAtMs : 0,
    tokenExpiresAtMs: connected ? cfg.accessTokenExpiresAtMs : 0,
    exportReady: false,
  };
}

async function loadConfig(): Promise<QboSecretConfig> {
  const snap = await CONFIG_REF.get();
  return secretFrom(snap.data() as Record<string, unknown> | undefined);
}

function basicAuth(clientId: string, clientSecret: string): string {
  return Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
}

async function postForm(
  url: string,
  body: Record<string, string>,
  headers: Record<string, string>,
): Promise<Record<string, unknown>> {
  const encoded = new URLSearchParams(body).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: encoded,
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const detail =
      String(json.error_description ?? json.error ?? json.message ?? text).trim() || `HTTP ${res.status}`;
    throw new HttpsError("failed-precondition", `QuickBooks OAuth failed: ${detail}`);
  }
  return json;
}

function applyTokenResponse(
  cfg: QboSecretConfig,
  token: Record<string, unknown>,
  realmId: string,
  email: string,
): Partial<QboSecretConfig> {
  const now = Date.now();
  const expiresIn = Number(token.expires_in ?? 3600) || 3600;
  const xRefresh = Number(token.x_refresh_token_expires_in ?? 0) || 0;
  return {
    accessToken: String(token.access_token ?? ""),
    refreshToken: String(token.refresh_token ?? cfg.refreshToken),
    tokenType: String(token.token_type ?? "bearer"),
    accessTokenExpiresAtMs: now + expiresIn * 1000,
    refreshTokenExpiresAtMs: xRefresh ? now + xRefresh * 1000 : cfg.refreshTokenExpiresAtMs,
    realmId: realmId || cfg.realmId,
    connectedAtMs: cfg.connectedAtMs || now,
    connectedBy: email,
  };
}

function apiBase(env: QboEnvironment): string {
  return env === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

async function fetchCompanyName(cfg: QboSecretConfig, accessToken: string, realmId: string): Promise<string> {
  if (!accessToken || !realmId) return "";
  try {
    const url = `${apiBase(cfg.environment)}/v3/company/${encodeURIComponent(realmId)}/companyinfo/${encodeURIComponent(realmId)}?minorversion=75`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!res.ok) return "";
    const json = (await res.json()) as {
      CompanyInfo?: { CompanyName?: string; LegalName?: string };
    };
    return String(json.CompanyInfo?.CompanyName || json.CompanyInfo?.LegalName || "").trim();
  } catch {
    return "";
  }
}

function pruneStates(
  states: QboSecretConfig["oauthStates"],
): QboSecretConfig["oauthStates"] {
  const now = Date.now();
  const next: QboSecretConfig["oauthStates"] = {};
  for (const [key, value] of Object.entries(states)) {
    if (value && value.expiresAtMs > now) next[key] = value;
  }
  return next;
}

export const saveQboConfig = onCall(QBO_CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const existing = await loadConfig();
  const clientId = String(data.clientId ?? "").trim();
  const clientSecret = String(data.clientSecret ?? "").trim();
  const environment = asEnv(data.environment, existing.environment || "sandbox");
  const redirectUri = String(data.redirectUri ?? "").trim() || existing.redirectUri || DEFAULT_QBO_REDIRECT_URI;

  if (!clientId) throw new HttpsError("invalid-argument", "QBO Client ID is required.");
  if (!clientSecret && !existing.clientSecret) {
    throw new HttpsError("invalid-argument", "QBO Client Secret is required the first time.");
  }
  if (!/^https:\/\//i.test(redirectUri)) {
    throw new HttpsError("invalid-argument", "Redirect URI must be an https:// URL.");
  }

  const nextSecret = clientSecret || existing.clientSecret;
  const stored: Record<string, unknown> = {
    clientId,
    clientSecret: nextSecret,
    clientSecretLast4: last4(nextSecret),
    environment,
    redirectUri,
    accessToken: existing.accessToken,
    refreshToken: existing.refreshToken,
    tokenType: existing.tokenType,
    accessTokenExpiresAtMs: existing.accessTokenExpiresAtMs,
    refreshTokenExpiresAtMs: existing.refreshTokenExpiresAtMs,
    realmId: existing.realmId,
    companyName: existing.companyName,
    connectedAtMs: existing.connectedAtMs,
    connectedBy: existing.connectedBy,
    oauthStates: pruneStates(existing.oauthStates),
    updatedAtMs: Date.now(),
    updatedBy: owner.email,
  };
  await CONFIG_REF.set(stored, { merge: true });
  await writeAudit({
    action: "save_qbo_config",
    adminEmail: owner.email,
    targetUid: "quickbooksOnline",
    detail: `env=${environment} clientId=${clientId.slice(0, 8)}…`,
  });
  return { ok: true, status: publicFrom(secretFrom(stored)) };
});

export const qboStatus = onCall(QBO_CALLABLE, async (request) => {
  await requireOwner(request);
  const cfg = await loadConfig();
  return { ok: true, status: publicFrom(cfg) };
});

export const qboStartConnect = onCall(QBO_CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const cfg = await loadConfig();
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new HttpsError(
      "failed-precondition",
      "Save your Intuit Client ID and Client Secret first (Settings → QuickBooks).",
    );
  }

  const state = crypto.randomBytes(24).toString("hex");
  const now = Date.now();
  const oauthStates = pruneStates(cfg.oauthStates);
  oauthStates[state] = {
    email: owner.email,
    createdAtMs: now,
    expiresAtMs: now + STATE_TTL_MS,
  };
  await CONFIG_REF.set({ oauthStates, updatedAtMs: now }, { merge: true });

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    scope: SCOPE,
    redirect_uri: cfg.redirectUri || DEFAULT_QBO_REDIRECT_URI,
    state,
  });
  const authorizeUrl = `${AUTH_URL}?${params.toString()}`;
  await writeAudit({
    action: "qbo_start_connect",
    adminEmail: owner.email,
    targetUid: "quickbooksOnline",
    detail: `env=${cfg.environment}`,
  });
  return {
    ok: true,
    authorizeUrl,
    redirectUri: cfg.redirectUri || DEFAULT_QBO_REDIRECT_URI,
    state,
  };
});

export const qboCompleteConnect = onCall(QBO_CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const code = String(data.code ?? "").trim();
  const state = String(data.state ?? "").trim();
  const realmId = String(data.realmId ?? "").trim();
  const oauthError = String(data.error ?? "").trim();
  const oauthErrorDescription = String(data.errorDescription ?? data.error_description ?? "").trim();

  if (oauthError) {
    throw new HttpsError(
      "failed-precondition",
      `QuickBooks denied access: ${oauthErrorDescription || oauthError}`,
    );
  }
  if (!code || !state) {
    throw new HttpsError("invalid-argument", "Missing OAuth code or state from QuickBooks.");
  }
  if (!realmId) {
    throw new HttpsError("invalid-argument", "Missing QuickBooks company (realmId) from the redirect.");
  }

  const cfg = await loadConfig();
  const pending = cfg.oauthStates[state];
  if (!pending || pending.expiresAtMs < Date.now()) {
    throw new HttpsError("failed-precondition", "OAuth state expired or unknown. Click Connect QuickBooks again.");
  }
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new HttpsError("failed-precondition", "QBO Client ID / Secret are not saved.");
  }

  const token = await postForm(
    TOKEN_URL,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: cfg.redirectUri || DEFAULT_QBO_REDIRECT_URI,
    },
    { Authorization: `Basic ${basicAuth(cfg.clientId, cfg.clientSecret)}` },
  );

  const patched = applyTokenResponse(cfg, token, realmId, owner.email);
  if (!patched.accessToken || !patched.refreshToken) {
    throw new HttpsError("internal", "QuickBooks did not return access and refresh tokens.");
  }

  const companyName =
    (await fetchCompanyName(cfg, String(patched.accessToken), realmId)) || cfg.companyName || "";

  const oauthStates = pruneStates(cfg.oauthStates);
  delete oauthStates[state];

  await CONFIG_REF.set(
    {
      accessToken: patched.accessToken,
      refreshToken: patched.refreshToken,
      tokenType: patched.tokenType,
      accessTokenExpiresAtMs: patched.accessTokenExpiresAtMs,
      refreshTokenExpiresAtMs: patched.refreshTokenExpiresAtMs,
      realmId: patched.realmId,
      companyName,
      connectedAtMs: patched.connectedAtMs,
      connectedBy: owner.email,
      oauthStates,
      updatedAtMs: Date.now(),
      updatedBy: owner.email,
    },
    { merge: true },
  );

  await writeAudit({
    action: "qbo_complete_connect",
    adminEmail: owner.email,
    targetUid: "quickbooksOnline",
    detail: `realmId=${realmId} company=${companyName || "(unknown)"}`,
  });

  const next = await loadConfig();
  return { ok: true, status: publicFrom(next) };
});

export const qboDisconnect = onCall(QBO_CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const cfg = await loadConfig();

  if (cfg.refreshToken && cfg.clientId && cfg.clientSecret) {
    try {
      await postForm(
        REVOKE_URL,
        { token: cfg.refreshToken },
        { Authorization: `Basic ${basicAuth(cfg.clientId, cfg.clientSecret)}` },
      );
    } catch {
      // Still clear local tokens if Intuit revoke fails (already revoked / expired).
    }
  }

  await CONFIG_REF.set(
    {
      accessToken: "",
      refreshToken: "",
      tokenType: "",
      accessTokenExpiresAtMs: 0,
      refreshTokenExpiresAtMs: 0,
      realmId: "",
      companyName: "",
      connectedAtMs: 0,
      connectedBy: "",
      oauthStates: {},
      updatedAtMs: Date.now(),
      updatedBy: owner.email,
    },
    { merge: true },
  );

  await writeAudit({
    action: "qbo_disconnect",
    adminEmail: owner.email,
    targetUid: "quickbooksOnline",
    detail: "disconnected",
  });

  const next = await loadConfig();
  return { ok: true, status: publicFrom(next) };
});
