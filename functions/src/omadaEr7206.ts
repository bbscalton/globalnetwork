import * as http from "http";
import * as https from "https";
import { URL } from "url";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE, db, requireOwner, writeAudit } from "./context";

const CONFIG_REF = db.collection("adminConfig").doc("omadaEr7206");
const TIMEOUT_MS = 15_000;
const DEFAULT_HW = "1.0";
const DEFAULT_FW = "1.4.2";
const OMADA_CALLABLE = { ...CALLABLE, timeoutSeconds: 60 as const };

export type OmadaClientRow = {
  mac: string;
  ip: string;
  hostname: string;
  blocked: boolean;
  active: boolean;
  trafficDown: number;
  trafficUp: number;
  lastSeenMs: number;
  gatewayMac: string;
  customerId: string;
  customerName: string;
  wireless: boolean;
  apName: string;
  apMac: string;
  ssid: string;
  deviceType: string;
  likelyCpe: boolean;
};

export type OmadaPublicConfig = {
  controllerUrl: string;
  username: string;
  passwordSaved: boolean;
  passwordLast4: string;
  siteName: string;
  deviceMac: string;
  cfAccessClientId: string;
  cfAccessSecretSaved: boolean;
  cfAccessSecretLast4: string;
  hardwareVersion: string;
  firmwareVersion: string;
  allowInsecureTls: boolean;
  autoSuspendOnExpire: boolean;
};

type OmadaSecretConfig = OmadaPublicConfig & {
  password: string;
  cfAccessClientSecret: string;
};

type Probe = {
  ok: boolean;
  connected: boolean;
  controllerOk: boolean;
  loginOk: boolean;
  siteFound: boolean;
  deviceFound: boolean;
  deviceOnline: boolean;
  deviceName: string;
  ip: string;
  status: string;
  hardwareVersion: string;
  firmwareVersion: string;
  error: string;
  config: OmadaPublicConfig;
};

function asBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "1") return true;
    if (v === "false" || v === "0") return false;
  }
  return fallback;
}

function last4(secret: string): string {
  const t = secret.trim();
  if (!t) return "";
  return t.length <= 4 ? t : t.slice(-4);
}

function normalizeUrl(raw: string): string {
  let url = raw.trim();
  url = url.replace(/\/+$/, "");
  url = url.replace(/\/(login|web|web\/#.*|#.*)$/i, "");
  url = url.replace(/\/+$/, "");
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

function publicFrom(data: Record<string, unknown> | undefined): OmadaPublicConfig {
  const d = data ?? {};
  return {
    controllerUrl: String(d.controllerUrl ?? ""),
    username: String(d.username ?? ""),
    passwordSaved: Boolean(String(d.password ?? "").trim()),
    passwordLast4: String(d.passwordLast4 ?? ""),
    siteName: String(d.siteName ?? "Default") || "Default",
    deviceMac: String(d.deviceMac ?? ""),
    cfAccessClientId: String(d.cfAccessClientId ?? ""),
    cfAccessSecretSaved: Boolean(String(d.cfAccessClientSecret ?? "").trim()),
    cfAccessSecretLast4: String(d.cfAccessSecretLast4 ?? ""),
    hardwareVersion: String(d.hardwareVersion ?? DEFAULT_HW) || DEFAULT_HW,
    firmwareVersion: String(d.firmwareVersion ?? DEFAULT_FW) || DEFAULT_FW,
    allowInsecureTls: d.allowInsecureTls === true,
    autoSuspendOnExpire: d.autoSuspendOnExpire === true,
  };
}

function secretFrom(data: Record<string, unknown> | undefined): OmadaSecretConfig {
  const pub = publicFrom(data);
  const d = data ?? {};
  return {
    ...pub,
    password: String(d.password ?? ""),
    cfAccessClientSecret: String(d.cfAccessClientSecret ?? ""),
  };
}

function emptyProbe(config: OmadaPublicConfig, error = ""): Probe {
  return {
    ok: false,
    connected: false,
    controllerOk: false,
    loginOk: false,
    siteFound: false,
    deviceFound: false,
    deviceOnline: false,
    deviceName: "",
    ip: "",
    status: error ? "error" : "disconnected",
    hardwareVersion: config.hardwareVersion || DEFAULT_HW,
    firmwareVersion: config.firmwareVersion || DEFAULT_FW,
    error,
    config,
  };
}

function applySetCookie(jar: Map<string, string>, headers: http.IncomingHttpHeaders): void {
  const raw = headers["set-cookie"];
  if (!raw) return;
  const list = Array.isArray(raw) ? raw : [raw];
  for (const line of list) {
    const pair = String(line).split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

function accessBlocked(status: number, text: string): boolean {
  if (status === 302 || status === 401 || status === 403) {
    const t = text.toLowerCase();
    if (t.includes("cloudflare") || t.includes("access") || t.includes("<html")) return true;
  }
  return /cf-access|cloudflareaccess/i.test(text);
}

type HttpResult = { status: number; headers: http.IncomingHttpHeaders; text: string };

function httpRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  jar: Map<string, string>,
  allowInsecureTls: boolean,
  redirects = 0,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error("Controller URL is not valid."));
      return;
    }
    const lib = parsed.protocol === "http:" ? http : https;
    const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    const nextHeaders: Record<string, string> = { ...headers };
    if (cookie) nextHeaders.Cookie = cookie;
    const opts: https.RequestOptions = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: `${parsed.pathname}${parsed.search}`,
      method,
      headers: nextHeaders,
      timeout: TIMEOUT_MS,
      rejectUnauthorized: !allowInsecureTls,
    };
    const req = lib.request(opts, (res) => {
      applySetCookie(jar, res.headers);
      const loc = res.headers.location;
      if (loc && res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && redirects < 5) {
        const next = new URL(String(loc), url).toString();
        res.resume();
        void httpRequest(next, method, headers, body, jar, allowInsecureTls, redirects + 1).then(resolve, reject);
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
    req.on("timeout", () => req.destroy(new Error("Omada request timed out after 15s.")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

class OmadaSession {
  token = "";
  omadacId = "";
  siteId = "";
  siteName = "";
  private jar = new Map<string, string>();

  constructor(private cfg: OmadaSecretConfig) {}

  private accessHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
    };
    if (this.cfg.cfAccessClientId && this.cfg.cfAccessClientSecret) {
      headers["CF-Access-Client-Id"] = this.cfg.cfAccessClientId;
      headers["CF-Access-Client-Secret"] = this.cfg.cfAccessClientSecret;
    }
    if (this.token) headers["Csrf-Token"] = this.token;
    return headers;
  }

  private withToken(path: string): string {
    if (!this.token) return path;
    return path.includes("?") ? `${path}&token=${encodeURIComponent(this.token)}` : `${path}?token=${encodeURIComponent(this.token)}`;
  }

  async call(method: string, path: string, body?: unknown): Promise<{ errorCode: number; msg: string; result: unknown; status: number; text: string }> {
    const url = `${this.cfg.controllerUrl}${this.withToken(path)}`;
    const payload = body == null ? undefined : JSON.stringify(body);
    const res = await httpRequest(url, method, this.accessHeaders(), payload, this.jar, this.cfg.allowInsecureTls);
    if (accessBlocked(res.status, res.text)) {
      throw new Error("Cloudflare Access blocked the controller. Add a service-token Client ID and Client Secret.");
    }
    let json: { errorCode?: number; msg?: string; result?: unknown } = {};
    try {
      json = JSON.parse(res.text) as { errorCode?: number; msg?: string; result?: unknown };
    } catch {
      if (res.status >= 400) throw new Error(`Omada HTTP ${res.status}.`);
      throw new Error("Omada returned a non-JSON response. Check the controller URL.");
    }
    const csrf = res.headers["csrf-token"] || res.headers["Csrf-Token"];
    if (csrf && !this.token) this.token = String(Array.isArray(csrf) ? csrf[0] : csrf);
    return {
      errorCode: Number(json.errorCode ?? (res.status >= 400 ? res.status : 0)),
      msg: String(json.msg ?? ""),
      result: json.result,
      status: res.status,
      text: res.text,
    };
  }

  async login(): Promise<void> {
    const info = await this.call("GET", "/api/info");
    const result = asRecord(info.result);
    this.omadacId = String(result.omadacId ?? result.omadaCid ?? result.controllerId ?? "");
    if (!this.omadacId || info.errorCode !== 0) {
      throw new Error(info.msg || "Could not read omadacId from /api/info. Is this an Omada software controller?");
    }
    const login = await this.call("POST", `/${this.omadacId}/api/v2/login`, {
      username: this.cfg.username,
      password: this.cfg.password,
    });
    const loginResult = asRecord(login.result);
    this.token = String(loginResult.token ?? this.token);
    if (login.errorCode !== 0 || !this.token) {
      throw new Error(login.msg || "Omada login failed. Check the dedicated API username and password.");
    }
  }

  async findSite(): Promise<void> {
    const wanted = this.cfg.siteName.trim().toLowerCase() || "default";
    const listed = await this.call("GET", `/${this.omadacId}/api/v2/sites?currentPage=1&currentPageSize=100`);
    if (listed.errorCode !== 0) throw new Error(listed.msg || "Could not list Omada sites.");
    const rows = listOf(listed.result);
    const match = rows.find((row) => String(row.name ?? "").trim().toLowerCase() === wanted) ?? rows.find((row) => wanted === "default" && String(row.name ?? "").toLowerCase() === "default");
    if (!match) throw new Error(`Site “${this.cfg.siteName || "Default"}” was not found on this controller.`);
    this.siteId = String(match.id ?? match.key ?? "");
    this.siteName = String(match.name ?? this.cfg.siteName);
    if (!this.siteId) throw new Error("Site was found but had no id.");
  }

  private sitePath(suffix: string): string {
    return `/${this.omadacId}/api/v2/sites/${this.siteId}${suffix}`;
  }

  async findGateway(): Promise<{
    found: boolean;
    online: boolean;
    name: string;
    ip: string;
    status: string;
    mac: string;
  }> {
    const want = normalizeMac(this.cfg.deviceMac);
    const buckets = [await this.call("GET", this.sitePath("/devices?currentPage=1&currentPageSize=100")), await this.call("GET", this.sitePath("/gateways?currentPage=1&currentPageSize=100"))];
    let found: Record<string, unknown> | null = null;
    for (const bucket of buckets) {
      if (bucket.errorCode !== 0) continue;
      for (const row of listOf(bucket.result)) {
        if (normalizeMac(String(row.mac ?? row.deviceMac ?? "")) === want) {
          found = row;
          break;
        }
      }
      if (found) break;
    }
    if (!found && want.length === 12) {
      const detail = await this.call("GET", this.sitePath(`/gateways/${hyphenMac(this.cfg.deviceMac)}`));
      if (detail.errorCode === 0 && asRecord(detail.result).mac) found = asRecord(detail.result);
    }
    if (!found) {
      return { found: false, online: false, name: "", ip: "", status: "", mac: hyphenMac(this.cfg.deviceMac) };
    }
    const statusRaw = found.status ?? found.statusCategory ?? found.type;
    const online = isDeviceOnline(found);
    return {
      found: true,
      online,
      name: String(found.name ?? found.model ?? "ER7206"),
      ip: String(found.ip ?? found.ipAddress ?? found.publicIp ?? ""),
      status: online ? "connected" : String(statusRaw ?? "offline"),
      mac: String(found.mac ?? hyphenMac(this.cfg.deviceMac)),
    };
  }

  async listClients(): Promise<OmadaClientRow[]> {
    const merged = new Map<string, OmadaClientRow>();
    const paths = [
      "/clients?currentPage=1&currentPageSize=100",
      "/insight/clients?currentPage=1&currentPageSize=100",
      "/clients?currentPage=1&currentPageSize=100&filters.active=false",
    ];
    const errors: string[] = [];
    for (const path of paths) {
      const res = await this.call("GET", this.sitePath(path));
      if (res.errorCode !== 0) {
        errors.push(`${path}: ${res.msg || res.errorCode}`);
        continue;
      }
      for (const row of listOf(res.result)) {
        const parsed = parseClient(row);
        if (!parsed) continue;
        const prev = merged.get(parsed.mac);
        merged.set(parsed.mac, prev ? mergeClient(prev, parsed) : parsed);
      }
    }
    const devices = await this.call("GET", this.sitePath("/devices?currentPage=1&currentPageSize=100"));
    if (devices.errorCode === 0) {
      for (const device of listOf(devices.result)) {
        if (!isAccessPoint(device)) continue;
        const apMac = hyphenMac(String(device.mac ?? ""));
        if (normalizeMac(apMac).length !== 12) continue;
        for (const path of [`/eaps/${apMac}/clients?currentPage=1&currentPageSize=100`, `/devices/${apMac}/clients?currentPage=1&currentPageSize=100`]) {
          const res = await this.call("GET", this.sitePath(path));
          if (res.errorCode !== 0) continue;
          for (const row of listOf(res.result)) {
            const parsed = parseClient({ ...row, apMac, apName: device.name ?? device.model, wireless: true });
            if (!parsed) continue;
            const prev = merged.get(parsed.mac);
            merged.set(parsed.mac, prev ? mergeClient(prev, parsed) : parsed);
          }
        }
      }
    }
    if (!merged.size && errors.length) {
      throw new Error(`Could not list Omada wireless clients. ${errors.join(" ")}`);
    }
    const all = [...merged.values()];
    const wirelessish = all.filter((row) => row.wireless || row.likelyCpe || row.blocked);
    const rows = wirelessish.length ? wirelessish : all;
    rows.sort((a, b) => Number(b.likelyCpe) - Number(a.likelyCpe) || Number(b.wireless) - Number(a.wireless) || Number(b.active) - Number(a.active) || a.hostname.localeCompare(b.hostname));
    return rows;
  }

  async setClientBlocked(mac: string, blocked: boolean): Promise<{ method: string; reconnectOk: boolean }> {
    const formatted = hyphenMac(mac);
    if (normalizeMac(formatted).length !== 12) throw new Error("CPE MAC must be 12 hex digits.");
    const action = blocked ? "block" : "unblock";
    const attempts: Array<{ method: string; path: string; body?: unknown }> = [
      { method: "POST", path: this.sitePath(`/cmd/clients/${formatted}/${action}`) },
      { method: "POST", path: this.sitePath(`/cmd/clients/${formatted}/${action}`), body: {} },
      { method: "POST", path: this.sitePath(`/clients/${formatted}/${action}`) },
      { method: "PATCH", path: this.sitePath(`/clients/${formatted}`), body: { block: blocked, blocked } },
    ];
    const errors: string[] = [];
    let method = "";
    for (const attempt of attempts) {
      const res = await this.call(attempt.method, attempt.path, attempt.body);
      if (res.errorCode === 0) {
        method = `${attempt.method} ${action}`;
        break;
      }
      errors.push(`${attempt.method} ${action}: ${res.msg || res.errorCode}`);
    }
    if (!method) {
      throw new Error(
        `Omada did not ${action} CPE ${formatted}. Tried cmd/clients/{mac}/${action} (5.13 web API). ${errors.join(" ")}`,
      );
    }
    let reconnectOk = false;
    if (blocked) {
      for (const path of [`/cmd/clients/${formatted}/disconnect`, `/clients/${formatted}`]) {
        const kick = await this.call(path.endsWith(formatted) && !path.includes("/cmd/") ? "DELETE" : "POST", this.sitePath(path));
        if (kick.errorCode === 0) {
          method = `${method}+kick`;
          break;
        }
      }
    } else {
      const reconnect = await this.call("POST", this.sitePath(`/cmd/clients/${formatted}/reconnect`));
      reconnectOk = reconnect.errorCode === 0;
    }
    return { method, reconnectOk };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function listOf(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((row) => row && typeof row === "object") as Record<string, unknown>[];
  const rec = asRecord(value);
  for (const key of ["data", "list", "content", "gateways", "devices", "clients"]) {
    if (Array.isArray(rec[key])) return listOf(rec[key]);
  }
  return [];
}

function parseClient(row: Record<string, unknown>): OmadaClientRow | null {
  const mac = hyphenMac(String(row.mac ?? row.clientMac ?? ""));
  if (normalizeMac(mac).length !== 12) return null;
  const lastSeen = Number(row.lastSeen ?? row.lastSeenTime ?? 0);
  const connectType = Number(row.connectType ?? -1);
  const apMac = hyphenMac(String(row.apMac ?? ""));
  const hostname = String(row.hostName ?? row.name ?? row.hostname ?? "");
  const deviceType = String(row.deviceType ?? row.connectDevType ?? "");
  const wireless =
    row.wireless === true ||
    connectType === 0 ||
    connectType === 1 ||
    Boolean(apMac) ||
    String(row.connectDevType ?? "").toLowerCase() === "ap";
  const likelyCpe = scoreLikelyCpe(hostname, deviceType, wireless, connectType);
  return {
    mac,
    ip: String(row.ip ?? row.ipAddress ?? ""),
    hostname,
    blocked: row.block === true || row.blocked === true,
    active: row.active === true || row.connected === true,
    trafficDown: Number(row.trafficDown ?? row.download ?? 0) || 0,
    trafficUp: Number(row.trafficUp ?? row.upload ?? 0) || 0,
    lastSeenMs: lastSeen > 10_000_000_000 ? lastSeen : lastSeen > 0 ? lastSeen * 1000 : 0,
    gatewayMac: hyphenMac(String(row.gatewayMac ?? "")),
    customerId: "",
    customerName: "",
    wireless,
    apName: String(row.apName ?? ""),
    apMac,
    ssid: String(row.ssid ?? ""),
    deviceType,
    likelyCpe,
  };
}

function scoreLikelyCpe(hostname: string, deviceType: string, wireless: boolean, connectType: number): boolean {
  if (connectType === 2) return false;
  const blob = `${hostname} ${deviceType}`.toLowerCase();
  if (/iphone|ipad|ipod|android|galaxy|pixel|macbook|windows|samsung|huawei|xiaomi|oneplus|watch\b/.test(blob)) return false;
  if (/mesh|station|cpe|bridge|wbs|pharos|eap|outdoor|omada|nanostation|litebeam|cpe/.test(blob)) return true;
  return wireless;
}

function isAccessPoint(row: Record<string, unknown>): boolean {
  const type = row.type ?? row.deviceType ?? row.category;
  if (type === 2 || type === "2" || type === "ap" || type === "eap") return true;
  const model = String(row.model ?? row.name ?? "").toLowerCase();
  return /\beap\b|\bap\b|omada/.test(model) && !/er7206|gateway|router/.test(model);
}

function mergeClient(a: OmadaClientRow, b: OmadaClientRow): OmadaClientRow {
  return {
    mac: a.mac,
    ip: a.ip || b.ip,
    hostname: a.hostname || b.hostname,
    blocked: a.blocked || b.blocked,
    active: a.active || b.active,
    trafficDown: Math.max(a.trafficDown, b.trafficDown),
    trafficUp: Math.max(a.trafficUp, b.trafficUp),
    lastSeenMs: Math.max(a.lastSeenMs, b.lastSeenMs),
    gatewayMac: a.gatewayMac || b.gatewayMac,
    customerId: a.customerId || b.customerId,
    customerName: a.customerName || b.customerName,
    wireless: a.wireless || b.wireless,
    apName: a.apName || b.apName,
    apMac: a.apMac || b.apMac,
    ssid: a.ssid || b.ssid,
    deviceType: a.deviceType || b.deviceType,
    likelyCpe: a.likelyCpe || b.likelyCpe,
  };
}

function isDeviceOnline(row: Record<string, unknown>): boolean {
  if (row.connected === true || row.online === true) return true;
  const status = row.status;
  if (status === 1 || status === "1") return true;
  if (typeof status === "string" && /connect/i.test(status) && !/disconnect/i.test(status)) return true;
  return false;
}

async function loadConfig(): Promise<OmadaSecretConfig | null> {
  const snap = await CONFIG_REF.get();
  if (!snap.exists) return null;
  return secretFrom(snap.data() as Record<string, unknown> | undefined);
}

async function probe(cfg: OmadaSecretConfig): Promise<Probe> {
  const pub = publicFrom(cfg);
  if (!cfg.controllerUrl || !cfg.username || !cfg.password || !cfg.deviceMac) {
    return emptyProbe(pub, "Save controller URL, username, password, and ER7206 MAC, then test connection.");
  }
  const session = new OmadaSession(cfg);
  try {
    await session.login();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Controller unreachable.";
    const loginFail = /login failed|username|password|credential/i.test(message);
    const probeResult = emptyProbe(pub, message);
    probeResult.controllerOk = !loginFail && !/cloudflare access/i.test(message);
    probeResult.loginOk = false;
    probeResult.status = "error";
    if (/timed out|ENOTFOUND|ECONNREFUSED|certificate|UNABLE_TO_VERIFY/i.test(message)) {
      probeResult.controllerOk = false;
    } else if (!loginFail) {
      probeResult.controllerOk = /omadacId|api\/info/i.test(message) ? false : true;
    } else {
      probeResult.controllerOk = true;
    }
    return probeResult;
  }
  const out = emptyProbe(pub);
  out.ok = true;
  out.controllerOk = true;
  out.loginOk = true;
  try {
    await session.findSite();
    out.siteFound = true;
  } catch (error) {
    out.status = "error";
    out.error = error instanceof Error ? error.message : "Site not found.";
    out.ok = false;
    return out;
  }
  const device = await session.findGateway();
  out.deviceFound = device.found;
  out.deviceOnline = device.online;
  out.deviceName = device.name;
  out.ip = device.ip;
  if (!device.found) {
    out.ok = false;
    out.status = "error";
    out.error = `No gateway with MAC ${hyphenMac(cfg.deviceMac)} on site “${session.siteName}”.`;
    return out;
  }
  out.connected = device.online;
  out.status = device.online ? "connected" : "disconnected";
  out.error = device.online ? "" : "Omada sees the MAC but the gateway is offline.";
  return out;
}

export const saveOmadaConfig = onCall(OMADA_CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const data = (request.data ?? {}) as Record<string, unknown>;
  const existingSnap = await CONFIG_REF.get();
  const existing = secretFrom(existingSnap.data() as Record<string, unknown> | undefined);
  const password = String(data.password ?? "").trim();
  const cfSecret = String(data.cfAccessClientSecret ?? "").trim();
  const controllerUrl = normalizeUrl(String(data.controllerUrl ?? ""));
  const username = String(data.username ?? "").trim();
  const siteName = String(data.siteName ?? "Default").trim() || "Default";
  const deviceMac = hyphenMac(String(data.deviceMac ?? ""));
  if (!controllerUrl) throw new HttpsError("invalid-argument", "Controller URL is required.");
  if (!/^https?:\/\//i.test(controllerUrl)) throw new HttpsError("invalid-argument", "Controller URL must start with https://");
  if (!username) throw new HttpsError("invalid-argument", "Omada username is required.");
  if (!password && !existing.password) throw new HttpsError("invalid-argument", "Omada password is required.");
  if (normalizeMac(deviceMac).length !== 12) throw new HttpsError("invalid-argument", "ER7206 MAC must be 12 hex digits.");
  const nextPassword = password || existing.password;
  const nextCfSecret = cfSecret || existing.cfAccessClientSecret;
  const stored: Record<string, unknown> = {
    controllerUrl,
    username,
    password: nextPassword,
    passwordLast4: last4(nextPassword),
    siteName,
    deviceMac,
    cfAccessClientId: String(data.cfAccessClientId ?? "").trim(),
    cfAccessClientSecret: nextCfSecret,
    cfAccessSecretLast4: last4(nextCfSecret),
    hardwareVersion: String(data.hardwareVersion ?? DEFAULT_HW).trim() || DEFAULT_HW,
    firmwareVersion: String(data.firmwareVersion ?? DEFAULT_FW).trim() || DEFAULT_FW,
    allowInsecureTls: asBool(data.allowInsecureTls, false),
    autoSuspendOnExpire: asBool(data.autoSuspendOnExpire, existing.autoSuspendOnExpire),
    updatedAtMs: Date.now(),
    updatedBy: owner.email,
  };
  await CONFIG_REF.set(stored, { merge: true });
  await writeAudit({
    action: "save_omada_er7206",
    adminEmail: owner.email,
    targetUid: "omadaEr7206",
    detail: `${controllerUrl} site=${siteName} mac=${deviceMac}`,
  });
  return { ok: true, config: publicFrom(stored) };
});

export const omadaEr7206Status = onCall(OMADA_CALLABLE, async (request) => {
  await requireOwner(request);
  const cfg = await loadConfig();
  if (!cfg) return emptyProbe(publicFrom(undefined), "No Omada connection saved yet.");
  return probe(cfg);
});

async function attachCustomers(clients: OmadaClientRow[]): Promise<OmadaClientRow[]> {
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

async function readySession(): Promise<OmadaSession> {
  const cfg = await loadConfig();
  if (!cfg?.password) throw new HttpsError("failed-precondition", "Save Omada connection settings first.");
  const session = new OmadaSession(cfg);
  await session.login();
  await session.findSite();
  return session;
}

export async function setOmadaClientBlockedInternal(mac: string, blocked: boolean): Promise<{ method: string; reconnectOk: boolean }> {
  const session = await readySession();
  return session.setClientBlocked(mac, blocked);
}

export const omadaEr7206ListClients = onCall(OMADA_CALLABLE, async (request) => {
  await requireOwner(request);
  try {
    const session = await readySession();
    const clients = await attachCustomers(await session.listClients());
    return { ok: true, clients };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", error instanceof Error ? error.message : "Could not list Omada clients.");
  }
});

export const omadaEr7206SetClientBlocked = onCall(OMADA_CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const blocked = asBool(request.data?.blocked, true);
  let mac = String(request.data?.mac ?? "").trim();
  const customerId = String(request.data?.customerId ?? "").trim();
  if (!mac && customerId) {
    const customer = await db.collection("customers").doc(customerId).get();
    if (!customer.exists) throw new HttpsError("not-found", "Customer not found.");
    mac = String(customer.get("omadaClientMac") ?? customer.get("cpeMac") ?? "");
  }
  if (normalizeMac(mac).length !== 12) {
    throw new HttpsError("invalid-argument", "Map the house CPE wireless MAC on the customer record first.");
  }
  try {
    const result = await setOmadaClientBlockedInternal(mac, blocked);
    await writeAudit({
      action: blocked ? "omada_client_block" : "omada_client_unblock",
      adminEmail: owner.email,
      targetUid: customerId || hyphenMac(mac),
      detail: `${hyphenMac(mac)} ${result.method}`,
    });
    return { ok: true, blocked, mac: hyphenMac(mac), method: result.method, reconnectOk: result.reconnectOk };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", error instanceof Error ? error.message : "Client block failed.");
  }
});

export const saveOmadaClientMap = onCall(OMADA_CALLABLE, async (request) => {
  const owner = await requireOwner(request);
  const customerId = String(request.data?.customerId ?? "").trim();
  const rawMac = String(request.data?.mac ?? "").trim();
  if (!customerId) throw new HttpsError("invalid-argument", "customerId is required.");
  const customer = await db.collection("customers").doc(customerId).get();
  if (!customer.exists) throw new HttpsError("not-found", "Customer not found.");
  if (!rawMac) {
    await customer.ref.update({ omadaClientMac: "", cpeMac: "", updatedAtMs: Date.now() });
    await writeAudit({ action: "omada_client_unmap", adminEmail: owner.email, targetUid: customerId });
    return { ok: true, customerId, mac: "" };
  }
  const mac = hyphenMac(rawMac);
  if (normalizeMac(mac).length !== 12) throw new HttpsError("invalid-argument", "Client MAC must be 12 hex digits.");
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
    action: "omada_client_map",
    adminEmail: owner.email,
    targetUid: customerId,
    detail: mac,
  });
  return { ok: true, customerId, mac };
});
