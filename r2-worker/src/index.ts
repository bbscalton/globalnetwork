const OWNER_EMAIL = "neuereatec@gmail.com";

type Env = {
  MEDIA_BUCKET: R2Bucket;
  DB: D1Database;
  EDGE_CACHE: KVNamespace;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_API_KEY?: string;
  MEDIA_SIGNING_SECRET?: string;
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
};

type Status = "ok" | "warn" | "fail";

function cors(body: unknown, status = 200): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: {
      "content-type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,HEAD,PUT,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
      "cache-control": "no-store",
    },
  });
}

function parseKey(key: string): { orgId: string | null; customerId: string | null; feature: string } {
  const parts = key.split("/").filter(Boolean);
  if (parts[0] === "orgs" && parts[2] === "customers") {
    return { orgId: parts[1] ?? null, customerId: parts[3] ?? null, feature: parts[4] || "other" };
  }
  return { orgId: null, customerId: null, feature: "other" };
}

async function ensureTables(env: Env): Promise<void> {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS storage_quotas (
      customer_id TEXT PRIMARY KEY,
      used_bytes INTEGER NOT NULL DEFAULT 0,
      updated_at_ms INTEGER NOT NULL
    )`,
  ).run();
}

async function probeD1(env: Env): Promise<{ status: Status; message: string; latencyMs: number }> {
  const started = Date.now();
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    return { status: "ok", message: "D1 ops database is reachable.", latencyMs: Date.now() - started };
  } catch (error) {
    return {
      status: "fail",
      message: error instanceof Error ? error.message : "D1 probe failed.",
      latencyMs: Date.now() - started,
    };
  }
}

async function probeKv(env: Env): Promise<{ status: Status; message: string; latencyMs: number }> {
  const started = Date.now();
  try {
    const existing = await env.EDGE_CACHE.get("__health_probe");
    if (existing != null) {
      return { status: "ok", message: "KV edge cache is reachable.", latencyMs: Date.now() - started };
    }
    await env.EDGE_CACHE.put("__health_probe", "1", { expirationTtl: 86400 });
    return { status: "ok", message: "KV edge cache is reachable.", latencyMs: Date.now() - started };
  } catch (error) {
    return {
      status: "fail",
      message: error instanceof Error ? error.message : "KV probe failed.",
      latencyMs: Date.now() - started,
    };
  }
}

async function probeR2(env: Env): Promise<{ status: Status; message: string; latencyMs: number }> {
  const started = Date.now();
  try {
    await env.MEDIA_BUCKET.list({ limit: 1 });
    return { status: "ok", message: "R2 media bucket is reachable.", latencyMs: Date.now() - started };
  } catch (error) {
    return {
      status: "fail",
      message: error instanceof Error ? error.message : "R2 probe failed.",
      latencyMs: Date.now() - started,
    };
  }
}

async function probeFirebase(env: Env): Promise<{ status: Status; message: string; latencyMs: number | null }> {
  const projectId = env.FIREBASE_PROJECT_ID?.trim();
  const apiKey = env.FIREBASE_API_KEY?.trim();
  if (!projectId && !apiKey) {
    return { status: "warn", message: "Firebase probe vars not set on Worker.", latencyMs: null };
  }
  const started = Date.now();
  try {
    if (apiKey) {
      const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects?key=${encodeURIComponent(apiKey)}`);
      const latencyMs = Date.now() - started;
      if (res.status === 200 || res.status === 400 || res.status === 403) {
        return { status: "ok", message: `Firebase Auth API reachable (HTTP ${res.status}).`, latencyMs };
      }
      return { status: "fail", message: `Firebase Auth API HTTP ${res.status}.`, latencyMs };
    }
    const res = await fetch(`https://${projectId}.firebaseapp.com/__/firebase/init.json`);
    return {
      status: res.ok || res.status === 404 ? "ok" : "fail",
      message: `Firebase domain HTTP ${res.status}.`,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    return {
      status: "fail",
      message: error instanceof Error ? error.message : "Firebase probe failed.",
      latencyMs: Date.now() - started,
    };
  }
}

function b64url(part: string): Uint8Array {
  const pad = "=".repeat((4 - (part.length % 4)) % 4);
  const raw = atob(`${part}${pad}`.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type FirebaseJwt = { kid?: string; alg?: string; iss?: string; aud?: string; exp?: number; sub?: string; email?: string; owner?: boolean };

let jwksCache: { atMs: number; keys: Array<JsonWebKey & { kid?: string }> } | null = null;

async function firebaseJwks(): Promise<Array<JsonWebKey & { kid?: string }>> {
  if (jwksCache && Date.now() - jwksCache.atMs < 50 * 60 * 1000) return jwksCache.keys;
  const res = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
  if (!res.ok) throw new Error(`jwks HTTP ${res.status}`);
  const json = (await res.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };
  const keys = json.keys ?? [];
  jwksCache = { atMs: Date.now(), keys };
  return keys;
}

async function verifyFirebaseJwt(token: string, projectId: string): Promise<{ uid: string; email: string; owner: boolean } | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header: FirebaseJwt;
  let payload: FirebaseJwt;
  try {
    header = JSON.parse(new TextDecoder().decode(b64url(parts[0]))) as FirebaseJwt;
    payload = JSON.parse(new TextDecoder().decode(b64url(parts[1]))) as FirebaseJwt;
  } catch {
    return null;
  }
  if (header.alg !== "RS256" || !header.kid) return null;
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) return null;
  if (payload.aud !== projectId) return null;
  if (!payload.sub) return null;
  if ((payload.exp ?? 0) * 1000 < Date.now() - 30_000) return null;
  const jwk = (await firebaseJwks()).find((key) => key.kid === header.kid);
  if (!jwk) return null;
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: jwk.n, e: jwk.e },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    cryptoKey,
    b64url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) return null;
  return { uid: payload.sub, email: (payload.email ?? "").trim().toLowerCase(), owner: payload.owner === true };
}

async function verifyFirebaseToken(request: Request, env: Env): Promise<{ uid: string; email: string; owner?: boolean } | null> {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const projectId = env.FIREBASE_PROJECT_ID?.trim() || "globalnetwork-isp";
  try {
    const jwtAuth = await verifyFirebaseJwt(token, projectId);
    if (jwtAuth) return jwtAuth;
  } catch {
    // Fall through to Identity Toolkit if an API key is configured.
  }
  const apiKey = env.FIREBASE_API_KEY?.trim();
  if (!apiKey) return null;
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken: token }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { users?: Array<{ localId?: string; email?: string }> };
  const user = json.users?.[0];
  if (!user?.localId) return null;
  return { uid: user.localId, email: (user.email ?? "").trim().toLowerCase() };
}

function isOwner(auth: { email: string; owner?: boolean } | null): boolean {
  return Boolean(auth?.email && (auth.email === OWNER_EMAIL || auth.owner === true));
}

function allowedKey(key: string): boolean {
  return /^orgs\/[^/]+\/customers\/[^/]+\/(issues|chat|kyc|calls)\/.+/.test(key);
}

type IceServer = { urls: string[]; username?: string; credential?: string };

const STUN_ONLY: IceServer[] = [
  { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] },
];

function withoutPort53(urls: string[]): string[] {
  return urls.filter((url) => !url.includes(":53"));
}

async function iceServersFor(env: Env): Promise<{ iceServers: IceServer[]; turn: boolean }> {
  const keyId = env.TURN_KEY_ID?.trim();
  const token = env.TURN_KEY_API_TOKEN?.trim();
  if (!keyId || !token) return { iceServers: STUN_ONLY, turn: false };
  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ ttl: 3600 }),
      },
    );
    if (!res.ok) return { iceServers: STUN_ONLY, turn: false };
    const json = (await res.json()) as {
      iceServers?: Array<{ urls?: string | string[]; username?: string; credential?: string }>;
    };
    const iceServers = (json.iceServers ?? [])
      .map((server) => {
        const urls = withoutPort53(Array.isArray(server.urls) ? server.urls : server.urls ? [server.urls] : []);
        return {
          urls,
          ...(server.username ? { username: server.username } : {}),
          ...(server.credential ? { credential: server.credential } : {}),
        };
      })
      .filter((server) => server.urls.length > 0);
    if (iceServers.length === 0) return { iceServers: STUN_ONLY, turn: false };
    return { iceServers, turn: true };
  } catch {
    return { iceServers: STUN_ONLY, turn: false };
  }
}

function isKycKey(key: string): boolean {
  return /\/kyc\//.test(key);
}

const APP_APK_KEY = "orgs/globalnetwork/app/globalnetwork-customer.apk";

function apkHeaders(size: number): Headers {
  const headers = new Headers();
  headers.set("access-control-allow-origin", "*");
  headers.set("content-type", "application/vnd.android.package-archive");
  headers.set("content-disposition", 'attachment; filename="GlobalNetwork.apk"');
  headers.set("cache-control", "public, max-age=300");
  headers.set("accept-ranges", "bytes");
  headers.set("content-length", String(size));
  return headers;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : "upload failed";
      return cors({ error: message }, 500);
    }
  },
};

async function handleRequest(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return cors({ ok: true });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (path === "/app/android.apk" || path === "/app/globalnetwork.apk") {
      if (request.method === "HEAD") {
        const meta = await env.MEDIA_BUCKET.head(APP_APK_KEY);
        if (!meta) return cors({ error: "Android app is not published yet." }, 404);
        return new Response(null, { headers: apkHeaders(meta.size) });
      }
      const obj = await env.MEDIA_BUCKET.get(APP_APK_KEY);
      if (!obj) return cors({ error: "Android app is not published yet." }, 404);
      return new Response(obj.body, { headers: apkHeaders(obj.size) });
    }

    if (path === "/health") {
      const r2 = await probeR2(env);
      return cors({ ok: r2.status !== "fail", r2, atMs: Date.now() });
    }

    if (path === "/platform-health") {
      const [r2, d1, kv, firebase] = await Promise.all([probeR2(env), probeD1(env), probeKv(env), probeFirebase(env)]);
      const statuses = [r2.status, d1.status, kv.status, firebase.status];
      const overall = statuses.includes("fail") ? "fail" : statuses.includes("warn") ? "warn" : "ok";
      return cors({ ok: overall !== "fail", overall, r2, d1, kv, firebase, atMs: Date.now() });
    }

    if (path === "/storage-dump") {
      const dumpAuth = await verifyFirebaseToken(request, env);
      if (!isOwner(dumpAuth)) return cors({ error: "owner only" }, 403);
      await ensureTables(env);
      const customers: Record<string, { bytes: number; objects: number }> = {};
      let objects = 0;
      let bytes = 0;
      let cursor: string | undefined;
      let truncated = false;
      do {
        const listed = await env.MEDIA_BUCKET.list({ cursor, limit: 1000 });
        for (const obj of listed.objects) {
          objects += 1;
          bytes += obj.size || 0;
          const parsed = parseKey(obj.key);
          if (parsed.customerId) {
            const row = customers[parsed.customerId] ?? (customers[parsed.customerId] = { bytes: 0, objects: 0 });
            row.bytes += obj.size || 0;
            row.objects += 1;
          }
        }
        cursor = listed.truncated ? listed.cursor : undefined;
        if (cursor) truncated = true;
      } while (cursor);
      return cors({ objects, bytes, truncated, customers });
    }

    if ((path === "/ice-servers" || path === "/iceServers") && (request.method === "GET" || request.method === "POST")) {
      const iceAuth = await verifyFirebaseToken(request, env);
      if (!iceAuth) return cors({ error: "unauthorized" }, 401);
      const payload = await iceServersFor(env);
      return cors(payload);
    }

    if (path === "/sign-upload" && request.method === "POST") {
      const auth = await verifyFirebaseToken(request, env);
      if (!auth) return cors({ error: "unauthorized" }, 401);
      const body = (await request.json()) as { key?: string; contentType?: string };
      const key = String(body.key ?? "");
      if (!allowedKey(key)) return cors({ error: "invalid key" }, 400);
      return cors({
        key,
        putUrl: `${url.origin}/object?key=${encodeURIComponent(key)}`,
        method: "PUT",
        headers: { "content-type": body.contentType || "application/octet-stream" },
      });
    }

    if (path === "/object") {
      const key = url.searchParams.get("key") || "";
      if (!allowedKey(key)) return cors({ error: "invalid key" }, 400);
      if (request.method === "PUT") {
        const auth = await verifyFirebaseToken(request, env);
        if (!auth) return cors({ error: "unauthorized" }, 401);
        const contentType = request.headers.get("content-type") || "application/octet-stream";
        const bytes = await request.arrayBuffer();
        await env.MEDIA_BUCKET.put(key, bytes, {
          httpMetadata: { contentType },
        });
        const parsed = parseKey(key);
        try {
          if (parsed.customerId) {
            await ensureTables(env);
            const size = Number(request.headers.get("content-length") || bytes.byteLength);
            await env.DB.prepare(
              `INSERT INTO storage_quotas (customer_id, used_bytes, updated_at_ms) VALUES (?, ?, ?)
             ON CONFLICT(customer_id) DO UPDATE SET used_bytes = used_bytes + excluded.used_bytes, updated_at_ms = excluded.updated_at_ms`,
            )
              .bind(parsed.customerId, Number.isFinite(size) ? size : bytes.byteLength, Date.now())
              .run();
          }
        } catch (error) {
          console.error("storage quota tracking failed", error);
        }
        return cors({ ok: true, key });
      }
      if (request.method === "GET" || request.method === "HEAD") {
        if (isKycKey(key)) {
          const viewAuth = await verifyFirebaseToken(request, env);
          if (!viewAuth) return cors({ error: "unauthorized" }, 401);
        }
        const rangeHeader = request.headers.get("range");
        const obj = rangeHeader && request.method === "GET"
          ? await env.MEDIA_BUCKET.get(key, { range: request.headers })
          : request.method === "HEAD"
            ? await env.MEDIA_BUCKET.head(key)
            : await env.MEDIA_BUCKET.get(key);
        if (!obj) return cors({ error: "not found" }, 404);
        const headers = new Headers();
        headers.set("access-control-allow-origin", "*");
        headers.set("access-control-allow-headers", "content-type,authorization,range");
        headers.set("access-control-expose-headers", "content-length,content-range,accept-ranges,content-type");
        headers.set("accept-ranges", "bytes");
        headers.set("cache-control", "public, max-age=3600");
        const typed = "httpMetadata" in obj ? obj.httpMetadata?.contentType : undefined;
        if (typed) headers.set("content-type", typed);
        else if (key.endsWith(".webm") || key.includes("/calls/")) headers.set("content-type", "audio/webm");
        else if (key.endsWith(".m4a") || key.includes("voice")) headers.set("content-type", "audio/mp4");
        else if (key.endsWith(".mp4") || key.includes("video")) headers.set("content-type", "video/mp4");
        if (request.method === "HEAD") {
          headers.set("content-length", String(obj.size));
          return new Response(null, { headers });
        }
        const bodyObj = obj as R2ObjectBody;
        const ranged = Boolean(rangeHeader && bodyObj.range);
        if (ranged && "offset" in (bodyObj.range ?? {})) {
          const range = bodyObj.range as { offset: number; length: number };
          const end = range.offset + range.length - 1;
          headers.set("content-range", `bytes ${range.offset}-${end}/${obj.size}`);
          headers.set("content-length", String(range.length));
        } else {
          headers.set("content-length", String(obj.size));
        }
        return new Response(bodyObj.body, { status: ranged ? 206 : 200, headers });
      }
    }

    return cors({ error: "not found" }, 404);
}
