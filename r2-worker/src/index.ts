const OWNER_EMAIL = "neuereatec@gmail.com";

type Env = {
  MEDIA_BUCKET: R2Bucket;
  DB: D1Database;
  EDGE_CACHE: KVNamespace;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_API_KEY?: string;
  MEDIA_SIGNING_SECRET?: string;
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
  await env.DB.exec(`
    CREATE TABLE IF NOT EXISTS storage_quotas (
      customer_id TEXT PRIMARY KEY,
      used_bytes INTEGER NOT NULL DEFAULT 0,
      updated_at_ms INTEGER NOT NULL
    );
  `);
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

async function verifyFirebaseToken(request: Request, env: Env): Promise<{ uid: string; email: string } | null> {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
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

function isOwner(auth: { email: string } | null): boolean {
  return Boolean(auth?.email && auth.email === OWNER_EMAIL);
}

function allowedKey(key: string): boolean {
  return /^orgs\/[^/]+\/customers\/[^/]+\/(issues|chat)\/.+/.test(key);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return cors({ ok: true });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

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
        await env.MEDIA_BUCKET.put(key, request.body, {
          httpMetadata: { contentType: request.headers.get("content-type") || "application/octet-stream" },
        });
        const parsed = parseKey(key);
        if (parsed.customerId) {
          await ensureTables(env);
          const size = Number(request.headers.get("content-length") || 0);
          await env.DB.prepare(
            `INSERT INTO storage_quotas (customer_id, used_bytes, updated_at_ms) VALUES (?, ?, ?)
             ON CONFLICT(customer_id) DO UPDATE SET used_bytes = used_bytes + excluded.used_bytes, updated_at_ms = excluded.updated_at_ms`,
          )
            .bind(parsed.customerId, size, Date.now())
            .run();
        }
        return cors({ ok: true, key });
      }
      if (request.method === "GET" || request.method === "HEAD") {
        const obj = await env.MEDIA_BUCKET.get(key);
        if (!obj) return cors({ error: "not found" }, 404);
        const headers = new Headers();
        headers.set("access-control-allow-origin", "*");
        headers.set("cache-control", "public, max-age=3600");
        if (obj.httpMetadata?.contentType) headers.set("content-type", obj.httpMetadata.contentType);
        if (request.method === "HEAD") return new Response(null, { headers });
        return new Response(obj.body, { headers });
      }
    }

    return cors({ error: "not found" }, 404);
  },
};
