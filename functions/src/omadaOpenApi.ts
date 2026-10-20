/**
 * Omada Controller Open API Integration (v5.13+)
 * 
 * Uses OAuth 2.0 client_credentials flow via Platform Integration > Open API.
 * 
 * Required credentials (set via Firebase Functions secrets):
 * - OMADA_CONTROLLER_URL: e.g. https://omada.example.com
 * - OMADA_CLIENT_ID: from Controller > Settings > Platform Integration > Open API
 * - OMADA_CLIENT_SECRET: from the same place
 * - OMADA_SITE_NAME: e.g. "Default" or the site where the ER7206 lives
 * 
 * Optional (if behind Cloudflare Access):
 * - OMADA_CF_ACCESS_CLIENT_ID
 * - OMADA_CF_ACCESS_CLIENT_SECRET
 * 
 * What the customer must provide:
 * 1. Omada Controller URL (the HTTPS address of the software/hardware controller)
 * 2. Open API credentials: Client ID and Client Secret (created in Controller > Settings > Platform Integration > Open API)
 * 3. Site name (usually "Default")
 * 4. If the controller is behind Cloudflare Access: CF Access service token (Client ID and Client Secret)
 * 5. Per-customer: the CPE MAC address (the wireless station MAC on the AP, NOT the ER7206 WAN MAC)
 */

import * as https from "https";
import * as http from "http";
import { URL } from "url";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { CALLABLE, db, requireOwner, writeAudit } from "./context";

const CONFIG_DOC = "omadaOpenApi";
const CONFIG_REF = db.collection("adminConfig").doc(CONFIG_DOC);
const TIMEOUT_MS = 20_000;
const TOKEN_CACHE_MS = 55 * 60 * 1000;

type OmadaOpenApiConfig = {
  controllerUrl: string;
  clientId: string;
  clientSecret: string;
  siteName: string;
  cfAccessClientId: string;
  cfAccessClientSecret: string;
  allowInsecureTls: boolean;
  autoBlockOnExpire: boolean;
  autoUnblockOnPayment: boolean;
  dryRun: boolean;
};

export type OmadaNetworkStatus = {
  configured: boolean;
  connected: boolean;
  controllerOk: boolean;
  authOk: boolean;
  siteFound: boolean;
  siteName: string;
  siteId: string;
  controllerId: string;
  error: string;
  config: OmadaPublicConfig;
  dryRun: boolean;
};

export type OmadaPublicConfig = {
  controllerUrl: string;
  clientIdSaved: boolean;
  clientIdLast4: string;
  clientSecretSaved: boolean;
  siteName: string;
  cfAccessConfigured: boolean;
  allowInsecureTls: boolean;
  autoBlockOnExpire: boolean;
  autoUnblockOnPayment: boolean;
  dryRun: boolean;
};

export type OmadaClientInfo = {
  mac: string;
  ip: string;
  hostname: string;
  blocked: boolean;
  active: boolean;
  wireless: boolean;
  apName: string;
  apMac: string;
  ssid: string;
  trafficDown: number;
  trafficUp: number;
  lastSeenMs: number;
  customerId: string;
  customerName: string;
  likelyCpe: boolean;
};

export type OmadaActionLog = {
  id: string;
  action: "block" | "unblock" | "test";
  mac: string;
  customerId: string;
  customerName: string;
  trigger: "expiry" | "payment" | "manual" | "test";
  dryRun: boolean;
  success: boolean;
  error: string;
  atMs: number;
  byEmail: string;
};

const CALLABLE_60S = { ...CALLABLE, timeoutSeconds: 60 as const };

let tokenCache: { token: string; expiresAt: number } | null = null;

function last4(secret: string): string {
  const t = secret.trim();
  return t.length <= 4 ? t : t.slice(-4);
}

function normalizeUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, "");
  url = url.replace(/\/(login|web|api|#.*|\?.*)?$/i, "").replace(/\/+$/, "");
  return url;
}

function normalizeMac(raw: string): string {
  return raw.replace(/[^a-fA-F0-9]/g, "").toUpperCase();
}

function hyphenMac(raw: string): string {
  const hex = normalizeMac(raw);
  if (hex.length !== 12) return raw.trim().toUpperCase();
  return hex.match(/.{2}/g)!.join("-");
}

function publicConfig(cfg: OmadaOpenApiConfig | null): OmadaPublicConfig {
  if (!cfg) {
    return {
      controllerUrl: "",
      clientIdSaved: false,
      clientIdLast4: "",
      clientSecretSaved: false,
      siteName: "Default",
      cfAccessConfigured: false,
      allowInsecureTls: false,
      autoBlockOnExpire: false,
      autoUnblockOnPayment: true,
      dryRun: true,
    };
  }
  return {
    controllerUrl: cfg.controllerUrl,
    clientIdSaved: Boolean(cfg.clientId),
    clientIdLast4: last4(cfg.clientId),
    clientSecretSaved: Boolean(cfg.clientSecret),
    siteName: cfg.siteName || "Default",
    cfAccessConfigured: Boolean(cfg.cfAccessClientId && cfg.cfAccessClientSecret),
    allowInsecureTls: cfg.allowInsecureTls,
    autoBlockOnExpire: cfg.autoBlockOnExpire,
    autoUnblockOnPayment: cfg.autoUnblockOnPayment,
    dryRun: cfg.dryRun,
  };
}

async function loadConfig(): Promise<OmadaOpenApiConfig | null> {
  const snap = await CONFIG_REF.get();
  if (!snap.exists) return null;
  const d = snap.data() ?? {};
  return {
    controllerUrl: String(d.controllerUrl ?? ""),
    clientId: String(d.clientId ?? ""),
    clientSecret: String(d.clientSecret ?? ""),
    siteName: String(d.siteName ?? "Default") || "Default",
    cfAccessClientId: String(d.cfAccessClientId ?? ""),
    cfAccessClientSecret: String(d.cfAccessClientSecret ?? ""),
    allowInsecureTls: d.allowInsecureTls === true,
    autoBlockOnExpire: d.autoBlockOnExpire === true,
    autoUnblockOnPayment: d.autoUnblockOnPayment !== false,
    dryRun: d.dryRun !== false,
  };
}

type HttpResult = { status: number; headers: http.IncomingHttpHeaders; text: string };

function httpRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  allowInsecureTls: boolean,
  redirects = 0,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error("Invalid controller URL"));
      return;
    }
    const lib = parsed.protocol === "http:" ? http : https;
    const opts: https.RequestOptions = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method,
      headers,
      timeout: TIMEOUT_MS,
      rejectUnauthorized: !allowInsecureTls,
    };
    const req = lib.request(opts, (res) => {
      const loc = res.headers.location;
      if (loc && res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && redirects < 5) {
        const next = new URL(String(loc), url).toString();
        res.resume();
        void httpRequest(next, method, headers, body, allowInsecureTls, redirects + 1).then(resolve, reject);
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk as Buffer));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          text: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("timeout", () => req.destroy(new Error("Omada request timed out")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

class OmadaOpenApiClient {
  private controllerId = "";
  private siteId = "";
  
  constructor(private cfg: OmadaOpenApiConfig) {}

  private cfAccessHeaders(): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.cfg.cfAccessClientId && this.cfg.cfAccessClientSecret) {
      h["CF-Access-Client-Id"] = this.cfg.cfAccessClientId;
      h["CF-Access-Client-Secret"] = this.cfg.cfAccessClientSecret;
    }
    return h;
  }

  private async getAccessToken(): Promise<string> {
    if (tokenCache && Date.now() < tokenCache.expiresAt) {
      return tokenCache.token;
    }
    
    const url = `${this.cfg.controllerUrl}/openapi/authorize/token?grant_type=client_credentials`;
    const auth = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
      ...this.cfAccessHeaders(),
    };
    
    const res = await httpRequest(url, "POST", headers, "{}", this.cfg.allowInsecureTls);
    if (res.status !== 200) {
      throw new Error(`OAuth token request failed: HTTP ${res.status}`);
    }
    
    let json: { errorCode?: number; msg?: string; result?: { accessToken?: string; expiresIn?: number } };
    try {
      json = JSON.parse(res.text);
    } catch {
      throw new Error("Invalid JSON response from Omada OAuth endpoint");
    }
    
    if (json.errorCode !== 0 || !json.result?.accessToken) {
      throw new Error(json.msg || "Failed to obtain access token from Omada controller");
    }
    
    const expiresIn = json.result.expiresIn ?? 3600;
    tokenCache = {
      token: json.result.accessToken,
      expiresAt: Date.now() + Math.min(expiresIn * 1000, TOKEN_CACHE_MS),
    };
    
    return tokenCache.token;
  }

  private async apiCall(method: string, path: string, body?: unknown): Promise<{ errorCode: number; msg: string; result: unknown }> {
    const token = await this.getAccessToken();
    const url = `${this.cfg.controllerUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `AccessToken=${token}`,
      ...this.cfAccessHeaders(),
    };
    
    const payload = body == null ? undefined : JSON.stringify(body);
    const res = await httpRequest(url, method, headers, payload, this.cfg.allowInsecureTls);
    
    let json: { errorCode?: number; msg?: string; result?: unknown } = {};
    try {
      json = JSON.parse(res.text);
    } catch {
      if (res.status >= 400) throw new Error(`Omada API HTTP ${res.status}`);
      throw new Error("Invalid JSON response from Omada API");
    }
    
    return {
      errorCode: Number(json.errorCode ?? (res.status >= 400 ? res.status : 0)),
      msg: String(json.msg ?? ""),
      result: json.result,
    };
  }

  async initialize(): Promise<{ controllerId: string; siteId: string; siteName: string }> {
    // Get controller ID from /openapi/v1/info
    const info = await this.apiCall("GET", "/openapi/v1/info");
    if (info.errorCode !== 0) {
      throw new Error(info.msg || "Could not get controller info");
    }
    const infoResult = info.result as Record<string, unknown> | undefined;
    this.controllerId = String(infoResult?.omadacId ?? infoResult?.controllerId ?? "");
    if (!this.controllerId) {
      throw new Error("Could not determine Omada controller ID");
    }
    
    // Find the site
    const sites = await this.apiCall("GET", `/openapi/v1/${this.controllerId}/sites?page=1&pageSize=100`);
    if (sites.errorCode !== 0) {
      throw new Error(sites.msg || "Could not list sites");
    }
    
    const sitesResult = sites.result as { data?: Array<{ siteId?: string; name?: string }> } | undefined;
    const siteList = sitesResult?.data ?? [];
    const wanted = this.cfg.siteName.trim().toLowerCase() || "default";
    const match = siteList.find(s => String(s.name ?? "").toLowerCase() === wanted) 
      ?? siteList.find(s => String(s.name ?? "").toLowerCase() === "default");
    
    if (!match?.siteId) {
      throw new Error(`Site "${this.cfg.siteName || "Default"}" not found on controller`);
    }
    
    this.siteId = match.siteId;
    return { controllerId: this.controllerId, siteId: this.siteId, siteName: String(match.name) };
  }

  private sitePath(suffix: string): string {
    return `/openapi/v1/${this.controllerId}/sites/${this.siteId}${suffix}`;
  }

  async listClients(): Promise<OmadaClientInfo[]> {
    const result: OmadaClientInfo[] = [];
    
    // List all clients (wired + wireless)
    const clients = await this.apiCall("GET", this.sitePath("/clients?page=1&pageSize=200"));
    if (clients.errorCode !== 0) {
      throw new Error(clients.msg || "Could not list clients");
    }
    
    const clientsResult = clients.result as { data?: Array<Record<string, unknown>> } | undefined;
    for (const c of clientsResult?.data ?? []) {
      const parsed = this.parseClient(c);
      if (parsed) result.push(parsed);
    }
    
    return result;
  }

  private parseClient(c: Record<string, unknown>): OmadaClientInfo | null {
    const mac = hyphenMac(String(c.mac ?? ""));
    if (normalizeMac(mac).length !== 12) return null;
    
    const connectType = Number(c.connectType ?? -1);
    const wireless = connectType === 0 || connectType === 1 || Boolean(c.apMac);
    const hostname = String(c.name ?? c.hostName ?? "");
    const deviceType = String(c.deviceType ?? "");
    
    return {
      mac,
      ip: String(c.ip ?? ""),
      hostname,
      blocked: c.block === true || c.blocked === true,
      active: c.active !== false,
      wireless,
      apName: String(c.apName ?? ""),
      apMac: hyphenMac(String(c.apMac ?? "")),
      ssid: String(c.ssid ?? ""),
      trafficDown: Number(c.download ?? 0),
      trafficUp: Number(c.upload ?? 0),
      lastSeenMs: Number(c.lastSeen ?? 0) * 1000,
      customerId: "",
      customerName: "",
      likelyCpe: this.scoreLikelyCpe(hostname, deviceType, wireless),
    };
  }

  private scoreLikelyCpe(hostname: string, deviceType: string, wireless: boolean): boolean {
    const blob = `${hostname} ${deviceType}`.toLowerCase();
    if (/iphone|ipad|android|galaxy|pixel|macbook|windows|samsung|huawei|xiaomi/.test(blob)) return false;
    if (/cpe|bridge|station|mesh|outdoor|nanostation|litebeam|sxt|pharos/.test(blob)) return true;
    return wireless;
  }

  /**
   * Block or unblock a wireless client MAC on the AP.
   * This does NOT touch the ER7206 gateway - only the client station.
   */
  async setClientBlocked(mac: string, blocked: boolean, dryRun: boolean): Promise<{ success: boolean; method: string; dryRun: boolean }> {
    const formatted = hyphenMac(mac);
    if (normalizeMac(formatted).length !== 12) {
      throw new Error("MAC must be 12 hex digits");
    }
    
    if (dryRun) {
      logger.info("omada_dry_run", { action: blocked ? "block" : "unblock", mac: formatted });
      return { success: true, method: "dry-run", dryRun: true };
    }
    
    // Open API v1: POST /sites/{siteId}/cmd/clients/{mac}/block or /unblock
    const action = blocked ? "block" : "unblock";
    const res = await this.apiCall("POST", this.sitePath(`/cmd/clients/${formatted}/${action}`), {});
    
    if (res.errorCode !== 0) {
      throw new Error(res.msg || `Failed to ${action} client ${formatted}`);
    }
    
    // If unblocking, also try to reconnect
    if (!blocked) {
      try {
        await this.apiCall("POST", this.sitePath(`/cmd/clients/${formatted}/reconnect`), {});
      } catch {
        // Reconnect is best-effort
      }
    }
    
    return { success: true, method: `openapi-${action}`, dryRun: false };
  }

  async testConnection(): Promise<OmadaNetworkStatus> {
    const pub = publicConfig(this.cfg);
    const status: OmadaNetworkStatus = {
      configured: Boolean(this.cfg.controllerUrl && this.cfg.clientId && this.cfg.clientSecret),
      connected: false,
      controllerOk: false,
      authOk: false,
      siteFound: false,
      siteName: "",
      siteId: "",
      controllerId: "",
      error: "",
      config: pub,
      dryRun: this.cfg.dryRun,
    };
    
    if (!status.configured) {
      status.error = "Missing controller URL, client ID, or client secret";
      return status;
    }
    
    try {
      // Test OAuth token
      await this.getAccessToken();
      status.controllerOk = true;
      status.authOk = true;
      
      // Test site lookup
      const site = await this.initialize();
      status.siteFound = true;
      status.siteName = site.siteName;
      status.siteId = site.siteId;
      status.controllerId = site.controllerId;
      status.connected = true;
    } catch (error) {
      status.error = error instanceof Error ? error.message : "Connection failed";
      if (status.authOk) {
        status.controllerOk = true;
      }
    }
    
    return status;
  }
}

async function getClient(): Promise<{ client: OmadaOpenApiClient; cfg: OmadaOpenApiConfig }> {
  const cfg = await loadConfig();
  if (!cfg?.clientId || !cfg?.clientSecret || !cfg?.controllerUrl) {
    throw new HttpsError("failed-precondition", "Omada Open API not configured. Save controller URL and OAuth credentials first.");
  }
  const client = new OmadaOpenApiClient(cfg);
  await client.initialize();
  return { client, cfg };
}

async function attachCustomers(clients: OmadaClientInfo[]): Promise<OmadaClientInfo[]> {
  const snap = await db.collection("customers").get();
  const byMac = new Map<string, { id: string; name: string }>();
  for (const doc of snap.docs) {
    const mac = normalizeMac(String(doc.get("omadaClientMac") ?? doc.get("cpeMac") ?? ""));
    if (mac.length === 12) byMac.set(mac, { id: doc.id, name: String(doc.get("name") ?? "") });
  }
  return clients.map((row) => {
    const mapped = byMac.get(normalizeMac(row.mac));
    return mapped ? { ...row, customerId: mapped.id, customerName: mapped.name } : row;
  });
}

async function logOmadaAction(log: Omit<OmadaActionLog, "id">): Promise<void> {
  const ref = db.collection("omadaActionLog").doc();
  await ref.set({ ...log, id: ref.id });
}

// ==================== Exported Functions ====================

/**
 * Save Omada Open API configuration.
 * Secrets are stored only in Firestore (adminConfig/omadaOpenApi), never exposed to clients.
 */
export const saveOmadaOpenApiConfig = onCall(CALLABLE_60S, async (request) => {
  const owner = await requireOwner(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  
  const existing = await loadConfig();
  const controllerUrl = normalizeUrl(String(data.controllerUrl ?? existing?.controllerUrl ?? ""));
  const clientId = String(data.clientId ?? "").trim() || existing?.clientId || "";
  const clientSecret = String(data.clientSecret ?? "").trim() || existing?.clientSecret || "";
  const siteName = String(data.siteName ?? existing?.siteName ?? "Default").trim() || "Default";
  const cfAccessClientId = String(data.cfAccessClientId ?? existing?.cfAccessClientId ?? "").trim();
  const cfAccessClientSecret = String(data.cfAccessClientSecret ?? "").trim() || existing?.cfAccessClientSecret || "";
  
  if (!controllerUrl) throw new HttpsError("invalid-argument", "Controller URL is required");
  if (!/^https?:\/\//i.test(controllerUrl)) throw new HttpsError("invalid-argument", "Controller URL must start with https://");
  if (!clientId) throw new HttpsError("invalid-argument", "Open API Client ID is required");
  if (!clientSecret) throw new HttpsError("invalid-argument", "Open API Client Secret is required");
  
  const stored: Record<string, unknown> = {
    controllerUrl,
    clientId,
    clientSecret,
    siteName,
    cfAccessClientId,
    cfAccessClientSecret,
    allowInsecureTls: data.allowInsecureTls === true,
    autoBlockOnExpire: data.autoBlockOnExpire === true,
    autoUnblockOnPayment: data.autoUnblockOnPayment !== false,
    dryRun: data.dryRun !== false,
    updatedAtMs: Date.now(),
    updatedBy: owner.email,
  };
  
  await CONFIG_REF.set(stored, { merge: true });
  tokenCache = null;
  
  await writeAudit({
    action: "save_omada_openapi_config",
    adminEmail: owner.email,
    targetUid: CONFIG_DOC,
    detail: `${controllerUrl} site=${siteName} dryRun=${stored.dryRun}`,
  });
  
  return { ok: true, config: publicConfig(stored as unknown as OmadaOpenApiConfig) };
});

/**
 * Test connection to Omada controller and return status.
 */
export const omadaOpenApiStatus = onCall(CALLABLE_60S, async (request) => {
  await requireOwner(request);
  const cfg = await loadConfig();
  if (!cfg) {
    return {
      configured: false,
      connected: false,
      controllerOk: false,
      authOk: false,
      siteFound: false,
      siteName: "",
      siteId: "",
      controllerId: "",
      error: "No Omada Open API configuration saved yet",
      config: publicConfig(null),
      dryRun: true,
    } as OmadaNetworkStatus;
  }
  const client = new OmadaOpenApiClient(cfg);
  return client.testConnection();
});

/**
 * List wireless clients visible to the controller.
 */
export const omadaOpenApiListClients = onCall(CALLABLE_60S, async (request) => {
  await requireOwner(request);
  try {
    const { client } = await getClient();
    const clients = await attachCustomers(await client.listClients());
    return { ok: true, clients };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", error instanceof Error ? error.message : "Could not list clients");
  }
});

/**
 * Block or unblock a customer's CPE MAC.
 * Can be called manually from the desk or automatically on expiry/payment.
 */
export const omadaOpenApiSetClientBlocked = onCall(CALLABLE_60S, async (request) => {
  const owner = await requireOwner(request);
  const blocked = request.data?.blocked === true;
  const customerId = String(request.data?.customerId ?? "").trim();
  let mac = String(request.data?.mac ?? "").trim();
  const trigger = String(request.data?.trigger ?? "manual") as OmadaActionLog["trigger"];
  const forceDryRun = request.data?.dryRun === true;
  
  if (!mac && customerId) {
    const customer = await db.collection("customers").doc(customerId).get();
    if (!customer.exists) throw new HttpsError("not-found", "Customer not found");
    mac = String(customer.get("omadaClientMac") ?? customer.get("cpeMac") ?? "");
  }
  
  if (normalizeMac(mac).length !== 12) {
    throw new HttpsError("invalid-argument", "Map the CPE MAC on the customer record first");
  }
  
  const customerDoc = customerId ? await db.collection("customers").doc(customerId).get() : null;
  const customerName = customerDoc?.exists ? String(customerDoc.get("name") ?? "") : "";
  
  try {
    const { client, cfg } = await getClient();
    const dryRun = forceDryRun || cfg.dryRun;
    const result = await client.setClientBlocked(mac, blocked, dryRun);
    
    await logOmadaAction({
      action: blocked ? "block" : "unblock",
      mac: hyphenMac(mac),
      customerId,
      customerName,
      trigger,
      dryRun,
      success: true,
      error: "",
      atMs: Date.now(),
      byEmail: owner.email,
    });
    
    await writeAudit({
      action: blocked ? "omada_block_client" : "omada_unblock_client",
      adminEmail: owner.email,
      targetUid: customerId || hyphenMac(mac),
      detail: `${hyphenMac(mac)} ${result.method} trigger=${trigger}`,
    });
    
    return { ok: true, blocked, mac: hyphenMac(mac), method: result.method, dryRun };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Block/unblock failed";
    
    await logOmadaAction({
      action: blocked ? "block" : "unblock",
      mac: hyphenMac(mac),
      customerId,
      customerName,
      trigger,
      dryRun: false,
      success: false,
      error: message,
      atMs: Date.now(),
      byEmail: owner.email,
    });
    
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", message);
  }
});

/**
 * Test blocking/unblocking a single customer (dry-run by default).
 */
export const omadaOpenApiTestCustomer = onCall(CALLABLE_60S, async (request) => {
  const owner = await requireOwner(request);
  const customerId = String(request.data?.customerId ?? "").trim();
  const testBlock = request.data?.testBlock !== false;
  
  if (!customerId) throw new HttpsError("invalid-argument", "customerId is required");
  
  const customer = await db.collection("customers").doc(customerId).get();
  if (!customer.exists) throw new HttpsError("not-found", "Customer not found");
  
  const mac = String(customer.get("omadaClientMac") ?? customer.get("cpeMac") ?? "");
  if (normalizeMac(mac).length !== 12) {
    throw new HttpsError("failed-precondition", "Customer has no CPE MAC mapped");
  }
  
  const { client, cfg } = await getClient();
  const customerName = String(customer.get("name") ?? "");
  
  // Always dry-run for test
  const blockResult = testBlock
    ? await client.setClientBlocked(mac, true, true)
    : { success: true, method: "skipped", dryRun: true };
  
  const unblockResult = await client.setClientBlocked(mac, false, true);
  
  await logOmadaAction({
    action: "test",
    mac: hyphenMac(mac),
    customerId,
    customerName,
    trigger: "test",
    dryRun: true,
    success: blockResult.success && unblockResult.success,
    error: "",
    atMs: Date.now(),
    byEmail: owner.email,
  });
  
  return {
    ok: true,
    customerId,
    customerName,
    mac: hyphenMac(mac),
    blockTest: blockResult,
    unblockTest: unblockResult,
    configDryRun: cfg.dryRun,
  };
});

/**
 * Save CPE MAC mapping for a customer.
 */
export const saveOmadaCpeMac = onCall(CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const customerId = String(request.data?.customerId ?? "").trim();
  const rawMac = String(request.data?.mac ?? "").trim();
  
  if (!customerId) throw new HttpsError("invalid-argument", "customerId is required");
  
  const customer = await db.collection("customers").doc(customerId).get();
  if (!customer.exists) throw new HttpsError("not-found", "Customer not found");
  
  if (!rawMac) {
    await customer.ref.update({ omadaClientMac: "", cpeMac: "", updatedAtMs: Date.now() });
    await writeAudit({ action: "omada_cpe_unmap", adminEmail: owner.email, targetUid: customerId });
    return { ok: true, customerId, mac: "" };
  }
  
  const mac = hyphenMac(rawMac);
  if (normalizeMac(mac).length !== 12) throw new HttpsError("invalid-argument", "MAC must be 12 hex digits");
  
  // Clear this MAC from any other customers
  const others = await db.collection("customers").get();
  const batch = db.batch();
  for (const doc of others.docs) {
    if (doc.id === customerId) continue;
    const existing = normalizeMac(String(doc.get("omadaClientMac") ?? doc.get("cpeMac") ?? ""));
    if (existing === normalizeMac(mac)) batch.update(doc.ref, { omadaClientMac: "", cpeMac: "" });
  }
  batch.update(customer.ref, { omadaClientMac: mac, cpeMac: mac, updatedAtMs: Date.now() });
  await batch.commit();
  
  await writeAudit({
    action: "omada_cpe_map",
    adminEmail: owner.email,
    targetUid: customerId,
    detail: mac,
  });
  
  return { ok: true, customerId, mac };
});

/**
 * Get action log entries.
 */
export const omadaOpenApiGetActionLog = onCall(CALLABLE, async (request) => {
  await requireOwner(request);
  const limit = Math.min(100, Math.max(1, Number(request.data?.limit ?? 50)));
  const customerId = String(request.data?.customerId ?? "").trim();
  
  let query = db.collection("omadaActionLog").orderBy("atMs", "desc").limit(limit);
  if (customerId) {
    query = db.collection("omadaActionLog")
      .where("customerId", "==", customerId)
      .orderBy("atMs", "desc")
      .limit(limit);
  }
  
  const snap = await query.get();
  const logs: OmadaActionLog[] = snap.docs.map(doc => doc.data() as OmadaActionLog);
  
  return { ok: true, logs };
});

// ==================== Internal Functions for Auto Block/Unblock ====================

/**
 * Internal: Block a customer's CPE on expiry.
 * Called from notify.ts expireSubscriptions.
 */
export async function blockCustomerCpeOnExpiry(customerId: string): Promise<{ blocked: boolean; mac: string; dryRun: boolean; error: string }> {
  const cfg = await loadConfig();
  if (!cfg?.autoBlockOnExpire) {
    return { blocked: false, mac: "", dryRun: false, error: "autoBlockOnExpire disabled" };
  }
  
  const customer = await db.collection("customers").doc(customerId).get();
  if (!customer.exists) {
    return { blocked: false, mac: "", dryRun: false, error: "customer not found" };
  }
  
  const mac = String(customer.get("omadaClientMac") ?? customer.get("cpeMac") ?? "");
  if (normalizeMac(mac).length !== 12) {
    return { blocked: false, mac: "", dryRun: false, error: "no CPE MAC mapped" };
  }
  
  const customerName = String(customer.get("name") ?? "");
  
  try {
    const client = new OmadaOpenApiClient(cfg);
    await client.initialize();
    await client.setClientBlocked(mac, true, cfg.dryRun);
    
    await logOmadaAction({
      action: "block",
      mac: hyphenMac(mac),
      customerId,
      customerName,
      trigger: "expiry",
      dryRun: cfg.dryRun,
      success: true,
      error: "",
      atMs: Date.now(),
      byEmail: "system@globalnetwork.local",
    });
    
    logger.info("omada_block_on_expiry", { customerId, mac, dryRun: cfg.dryRun });
    return { blocked: !cfg.dryRun, mac: hyphenMac(mac), dryRun: cfg.dryRun, error: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "block failed";
    
    await logOmadaAction({
      action: "block",
      mac: hyphenMac(mac),
      customerId,
      customerName,
      trigger: "expiry",
      dryRun: cfg.dryRun,
      success: false,
      error: message,
      atMs: Date.now(),
      byEmail: "system@globalnetwork.local",
    });
    
    logger.warn("omada_block_on_expiry_failed", { customerId, mac, error: message });
    return { blocked: false, mac: hyphenMac(mac), dryRun: cfg.dryRun, error: message };
  }
}

/**
 * Internal: Unblock a customer's CPE on payment/extension.
 * Called from subscriptions.ts after successful payment.
 */
export async function unblockCustomerCpeOnPayment(customerId: string): Promise<{ unblocked: boolean; mac: string; dryRun: boolean; error: string }> {
  const cfg = await loadConfig();
  if (!cfg?.autoUnblockOnPayment) {
    return { unblocked: false, mac: "", dryRun: false, error: "autoUnblockOnPayment disabled" };
  }
  
  const customer = await db.collection("customers").doc(customerId).get();
  if (!customer.exists) {
    return { unblocked: false, mac: "", dryRun: false, error: "customer not found" };
  }
  
  const mac = String(customer.get("omadaClientMac") ?? customer.get("cpeMac") ?? "");
  if (normalizeMac(mac).length !== 12) {
    return { unblocked: false, mac: "", dryRun: false, error: "no CPE MAC mapped" };
  }
  
  const customerName = String(customer.get("name") ?? "");
  
  try {
    const client = new OmadaOpenApiClient(cfg);
    await client.initialize();
    await client.setClientBlocked(mac, false, cfg.dryRun);
    
    await logOmadaAction({
      action: "unblock",
      mac: hyphenMac(mac),
      customerId,
      customerName,
      trigger: "payment",
      dryRun: cfg.dryRun,
      success: true,
      error: "",
      atMs: Date.now(),
      byEmail: "system@globalnetwork.local",
    });
    
    logger.info("omada_unblock_on_payment", { customerId, mac, dryRun: cfg.dryRun });
    return { unblocked: !cfg.dryRun, mac: hyphenMac(mac), dryRun: cfg.dryRun, error: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unblock failed";
    
    await logOmadaAction({
      action: "unblock",
      mac: hyphenMac(mac),
      customerId,
      customerName,
      trigger: "payment",
      dryRun: cfg.dryRun,
      success: false,
      error: message,
      atMs: Date.now(),
      byEmail: "system@globalnetwork.local",
    });
    
    logger.warn("omada_unblock_on_payment_failed", { customerId, mac, error: message });
    return { unblocked: false, mac: hyphenMac(mac), dryRun: cfg.dryRun, error: message };
  }
}
