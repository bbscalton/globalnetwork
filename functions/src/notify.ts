import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { DEFAULT_ORG_ID, db, sendToOwners, sendToToken } from "./context";

/**
 * Alert configuration for web customers who cannot receive push notifications.
 * Email and WhatsApp deep-link support is behind config to avoid committing secrets.
 * 
 * To enable email alerts:
 * 1. Store SENDGRID_API_KEY or MAILGUN_API_KEY in Firebase environment config
 * 2. Set adminConfig/alertConfig.emailEnabled = true
 * 3. Set adminConfig/alertConfig.emailFromAddress = "alerts@yourdomain.com"
 * 
 * To enable WhatsApp deep-link (opens customer's WhatsApp app with pre-filled message):
 * 1. Set adminConfig/alertConfig.whatsappEnabled = true
 * 2. Set adminConfig/alertConfig.whatsappBusinessPhone = "12685551234" (no +)
 * 
 * The actual sending is handled by sendAlertFallback() which checks these configs.
 */
interface AlertConfig {
  emailEnabled?: boolean;
  emailFromAddress?: string;
  emailProvider?: "sendgrid" | "mailgun";
  whatsappEnabled?: boolean;
  whatsappBusinessPhone?: string;
}

async function getAlertConfig(): Promise<AlertConfig> {
  try {
    const doc = await db.collection("adminConfig").doc("alertConfig").get();
    if (!doc.exists) return {};
    return doc.data() as AlertConfig;
  } catch (e) {
    logger.warn("getAlertConfig failed", e);
    return {};
  }
}

/**
 * Send alert to web customers who cannot receive FCM push.
 * Falls back to email or WhatsApp deep-link based on config.
 * Does NOT commit secrets - relies on env vars or adminConfig.
 */
async function sendAlertFallback(
  customer: { email?: string; phone?: string; name?: string },
  title: string,
  body: string,
): Promise<{ sent: boolean; method?: string }> {
  const config = await getAlertConfig();
  
  // Try email first if configured
  if (config.emailEnabled && config.emailFromAddress && customer.email) {
    const apiKey = process.env.SENDGRID_API_KEY || process.env.MAILGUN_API_KEY;
    if (apiKey) {
      try {
        if (process.env.SENDGRID_API_KEY) {
          const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              personalizations: [{ to: [{ email: customer.email }] }],
              from: { email: config.emailFromAddress, name: "GlobalNetwork Antigua" },
              subject: title,
              content: [{ type: "text/plain", value: body }],
            }),
          });
          if (res.ok || res.status === 202) {
            return { sent: true, method: "email-sendgrid" };
          }
          logger.warn("SendGrid failed", { status: res.status });
        } else if (process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN) {
          const domain = process.env.MAILGUN_DOMAIN;
          const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
            method: "POST",
            headers: {
              "Authorization": `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              from: `GlobalNetwork <${config.emailFromAddress}>`,
              to: customer.email,
              subject: title,
              text: body,
            }),
          });
          if (res.ok) {
            return { sent: true, method: "email-mailgun" };
          }
          logger.warn("Mailgun failed", { status: res.status });
        }
      } catch (e) {
        logger.warn("Email send failed", e);
      }
    }
  }
  
  // Log that we couldn't send (WhatsApp would need client-side handling)
  if (config.whatsappEnabled && config.whatsappBusinessPhone && customer.phone) {
    // WhatsApp Business API requires approved templates and secrets we don't commit.
    // Log that a WhatsApp-capable customer missed an alert for manual follow-up.
    logger.info("whatsapp-alert-candidate", {
      phone: customer.phone,
      name: customer.name,
      title,
    });
    return { sent: false, method: "whatsapp-logged" };
  }
  
  return { sent: false };
}

export { sendAlertFallback };

const BOT_COOLDOWN_MS = 40_000;
const COORD = /^\s*(-?\d{1,2}\.\d+)\s*[ ,]\s*(-?\d{1,3}\.\d+)\s*$/;

function fromOwner(from: string): boolean {
  return from === "owner" || from === "staff";
}

function chatKind(data: { kind?: unknown; mediaUrl?: unknown; lat?: unknown }): string {
  const kind = String(data.kind ?? "text");
  if (kind === "voice" || kind === "video" || kind === "text" || kind === "location" || kind === "call") return kind;
  if (data.lat != null) return "location";
  const url = String(data.mediaUrl ?? "").toLowerCase();
  if (url.includes("/calls/") || url.includes(".webm")) return "call";
  if (url.includes("video") || url.includes(".mp4")) return "video";
  if (url.includes("voice") || url.includes(".m4a") || url.includes("audio")) return "voice";
  return "text";
}

function previewFor(kind: string, text: string): string {
  if (kind === "voice") return "Voice note";
  if (kind === "video") return "Video clip";
  if (kind === "location") return "Shared location";
  if (kind === "call") return text.toLowerCase().includes("recording") ? "Call recording" : "Voice call";
  return text.slice(0, 80) || "Chat message";
}

function nameLooksMissing(name: string, email: string): boolean {
  const n = name.trim();
  if (n.length < 2) return true;
  if (n.includes("@") || /^customer$/i.test(n)) return true;
  const local = (email.split("@")[0] || "").replace(/[._]/g, " ");
  return n.toLowerCase() === local.toLowerCase();
}

function looksLikePersonName(text: string): boolean {
  const t = text.trim();
  if (t.length < 2 || t.length > 48) return false;
  if (/https?:|@|\d{3,}/.test(t)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;
  if (words.length === 1 && /^(hi|hey|hello|yes|no|ok|thanks|down|slow)$/i.test(t)) return false;
  return /^[\p{L}][\p{L}\s'.-]+$/u.test(t);
}

function botIntro(hasName: boolean, hasPin: boolean): string {
  const bits = [
    "GlobalNetwork desk bot here until a live agent takes over.",
  ];
  if (!hasName) bits.push("What name should we put on this report?");
  if (!hasPin) {
    bits.push(
      hasName
        ? "Optional: tap Share location so we can send a technician to the right village. You can also type All Saints, Potters, Bolans, Jennings — we will not store raw GPS as your address."
        : "After your name, you can optionally share location so a technician can find the CPE.",
    );
  }
  bits.push("A voice note or a short clip of the problem also helps.");
  return bits.join(" ");
}

async function ensureChatIssue(customerId: string, name: string, kind: string, text: string): Promise<void> {
  const customerRef = db.collection("customers").doc(customerId);
  const customer = await customerRef.get();
  const existingId = String(customer.get("openChatIssueId") ?? "");
  if (existingId) {
    const ticket = await customerRef.collection("issues").doc(existingId).get();
    if (ticket.exists && String(ticket.get("status") ?? "") !== "resolved") return;
  }
  const title =
    kind === "voice"
      ? "Voice report from chat"
      : kind === "video"
        ? "Video report from chat"
        : kind === "location"
          ? "Location shared for a technician"
          : kind === "call"
            ? "Voice call to the desk"
            : "Reported in chat";
  const body =
    kind === "text"
      ? text.slice(0, 400)
      : kind === "location"
        ? `Customer shared a map pin${text ? `: ${text.slice(0, 240)}` : "."}`
        : kind === "call"
          ? "Customer called the desk on in-app VoIP."
          : `${kind === "video" ? "Customer sent a video clip" : "Customer sent a voice note"}${text && !/^(voice note|video clip)$/i.test(text) ? `: ${text.slice(0, 240)}` : "."}`;
  const ref = await customerRef.collection("issues").add({
    title,
    body,
    status: "open",
    photoUrls: [],
    createdAtMs: Date.now(),
    source: "chat-bot",
  });
  await customerRef.update({ openChatIssueId: ref.id });
}

export const expireSubscriptions = onSchedule("every 5 minutes", async () => {
  const now = Date.now();
  // Query only customers due for status change: paidUntilMs <= now AND not suspended
  // This avoids scanning all customers every run
  const dueSnap = await db
    .collection("customers")
    .where("paidUntilMs", "<=", now)
    .where("paidUntilMs", ">", 0)
    .get();
  const omadaCfg = await db.collection("adminConfig").doc("omadaEr7206").get();
  const autoBlock = omadaCfg.get("autoSuspendOnExpire") === true;
  let flipped = 0;
  let blocked = 0;
  let scanned = 0;
  for (const doc of dueSnap.docs) {
    scanned += 1;
    const status = String(doc.get("status") ?? "");
    if (status === "suspended") continue;
    const paidUntil = Number(doc.get("paidUntilMs") ?? 0);
    const graceUntil = Number(doc.get("graceUntilMs") ?? 0);
    let next = status;
    if (paidUntil > 0 && now > paidUntil) {
      if (graceUntil > now) next = "grace";
      else next = "expired";
    }
    if (next !== status) {
      const feeAmount = Number(doc.get("feeAmount") ?? 0);
      const planAssigned = Boolean(String(doc.get("planId") ?? "").trim()) || feeAmount > 0;
      const hasSplit = doc.get("planDue") != null || doc.get("extensionDue") != null;
      const fee = planAssigned && feeAmount > 0 ? feeAmount : 0;
      const extensionDue = hasSplit ? Math.max(0, Number(doc.get("extensionDue") ?? 0)) : 0;
      const planDue = fee;
      const balanceDue = Math.max(0, planDue) + Math.max(0, extensionDue);
      await doc.ref.update({
        status: next,
        lastExpireSweepMs: now,
        planDue,
        extensionDue,
        balanceDue,
      });
      flipped += 1;
      const left = Math.ceil((paidUntil - now) / (24 * 60 * 60 * 1000));
      if (left <= 3) {
        const fcmToken = doc.get("fcmToken") as string | undefined;
        const alertTitle = "GlobalNetwork";
        const alertBody = next === "expired" 
          ? "Your internet subscription has expired." 
          : "Your service is in a grace period.";
        
        // Try FCM push first
        await sendToToken(fcmToken, alertTitle, alertBody, { type: "expiry", customerId: doc.id });
        
        // For web customers without FCM token, try email/WhatsApp fallback
        if (!fcmToken) {
          await sendAlertFallback(
            {
              email: String(doc.get("email") ?? ""),
              phone: String(doc.get("phone") ?? ""),
              name: String(doc.get("name") ?? ""),
            },
            alertTitle,
            alertBody,
          );
        }
      }
      if (next === "expired") {
        // Try new Open API first, fall back to legacy web UI API
        try {
          const { blockCustomerCpeOnExpiry } = await import("./omadaOpenApi");
          const result = await blockCustomerCpeOnExpiry(doc.id);
          if (result.blocked || result.dryRun) {
            blocked += 1;
            logger.info("omada_cpe_blocked", { customerId: doc.id, mac: result.mac, dryRun: result.dryRun });
          } else if (result.error && result.error !== "autoBlockOnExpire disabled" && result.error !== "no CPE MAC mapped") {
            logger.warn("omada_cpe_block_failed", { customerId: doc.id, error: result.error });
          }
        } catch (error) {
          // Fall back to legacy API if Open API not configured
          if (autoBlock) {
            const mac = String(doc.get("omadaClientMac") ?? doc.get("cpeMac") ?? "");
            if (mac) {
              try {
                const { setOmadaClientBlockedInternal } = await import("./omadaEr7206");
                await setOmadaClientBlockedInternal(mac, true);
                blocked += 1;
              } catch (legacyError) {
                logger.warn("omada_legacy_block_skipped", { customerId: doc.id, message: legacyError instanceof Error ? legacyError.message : String(legacyError) });
              }
            }
          }
        }
      }
    }
  }
  logger.info("expireSubscriptions", { scanned, flipped, blocked });
});

export const onChatCreated = onDocumentCreated(
  "customers/{customerId}/chatMessages/{messageId}",
  async (event) => {
    const data = event.data?.data();
    const customerId = event.params.customerId;
    if (!data) return;
    const customerRef = db.collection("customers").doc(customerId);
    const customer = await customerRef.get();
    const from = String(data.from ?? "");
    const kind = chatKind(data);
    const text = String(data.text ?? "");
    const preview = previewFor(kind, text);
    const now = Date.now();

    await customerRef.update({
      lastChatPreview: preview,
      lastChatAtMs: Number(data.createdAtMs ?? now),
      lastChatKind: kind,
      lastChatFrom: from,
    });

    const lat = Number(data.lat ?? Number.NaN);
    const lng = Number(data.lng ?? Number.NaN);
    if (kind === "location" && Number.isFinite(lat) && Number.isFinite(lng)) {
      const label = text && !/^-?\d+\.\d+/.test(text) ? text : "Shared pin in Antigua";
      const currentAddress = String(customer.get("address") ?? "");
      await customerRef.update({
        lat,
        lng,
        locationLabel: label,
        ...(COORD.test(currentAddress) || !currentAddress ? { address: label } : {}),
      });
    }

    if (from === "bot") {
      await sendToToken(customer.get("fcmToken") as string | undefined, "GlobalNetwork", preview, {
        type: "chat",
        customerId,
      });
      return;
    }

    if (fromOwner(from)) {
      await customerRef.update({ chatAgentLive: true });
      await sendToToken(customer.get("fcmToken") as string | undefined, "GlobalNetwork", text || "New message from GlobalNetwork", {
        type: "chat",
        customerId,
      });
      return;
    }

    await customerRef.update({
      unreadStaff: (Number(customer.get("unreadStaff") ?? 0) || 0) + 1,
    });
    if (kind !== "call") {
      await sendToOwners(String(customer.get("name") ?? "Customer"), preview, {
        type: "chat",
        customerId,
      });
    }

    if (kind === "call") return;

    const org = await db.collection("orgs").doc(DEFAULT_ORG_ID).get();
    if (org.get("botEnabled") === false) return;

    const agentLive = customer.get("chatAgentLive") === true;
    const lastBot = Number(customer.get("lastBotReplyMs") ?? 0);
    if (agentLive) return;

    const missingName = nameLooksMissing(String(customer.get("name") ?? ""), String(customer.get("email") ?? ""));
    const hasPin = Number.isFinite(Number(customer.get("lat"))) || kind === "location";
    const gathering = missingName || (!hasPin && lastBot === 0) || kind === "location";
    if (!gathering && now - lastBot < BOT_COOLDOWN_MS && kind === "text") return;

    try {
      const problem =
        kind !== "text" ||
        /down|slow|outage|pay|bill|happen|issue|light|offline|lost|no internet|not working/i.test(text);
      if (problem) {
        await ensureChatIssue(customerId, String(customer.get("name") ?? "Customer"), kind, text);
      }

      let reply = "";
      if (missingName && kind === "text" && looksLikePersonName(text)) {
        await customerRef.update({ name: text.trim() });
        reply = hasPin
          ? `Thanks ${text.trim().split(" ")[0]}. I have your pin on the technician map. Stay in this chat until a live agent joins.`
          : `Thanks ${text.trim().split(" ")[0]}. Optional next: tap Share location so we can send a technician to the village, or type the village name (All Saints, Potters, Bolans…).`;
      } else if (kind === "location") {
        reply = missingName
          ? "Pin is on the field map. What name should we put on this report?"
          : `${String(customer.get("name") ?? "Thanks").split(" ")[0]}, the technician map has your pin. A live agent will take this if they join.`;
      } else if (lastBot === 0) {
        reply = botIntro(!missingName, hasPin);
      } else if (missingName) {
        reply = "I still need the name for this account. Reply with first and last name if you can.";
      } else if (!hasPin && /village|location|where|address|all saints|potters|bolans|jennings/i.test(text)) {
        await customerRef.update({ address: text.trim(), locationLabel: text.trim() });
        reply = "Village saved on the record. A shared pin is even better if you can tap Share location.";
      } else {
        const who = String(customer.get("name") ?? "there").split(" ")[0] || "there";
        if (kind === "voice") {
          reply = `${who}, voice note is on the desk. Optional: share location so we can send a technician.`;
        } else if (kind === "video") {
          reply = `${who}, clip saved. Optional: share location so we can find the CPE.`;
        } else {
          reply = `${who}, logged. A live agent will take over this chat. Optional: share location if a technician visit is needed.`;
        }
      }

      await customerRef.collection("chatMessages").add({
        from: "bot",
        text: reply,
        kind: "text",
        createdAtMs: Date.now(),
      });
      await customerRef.update({ lastBotReplyMs: Date.now() });
    } catch (error) {
      logger.error("desk bot failed", { customerId, error });
    }
  },
);

export const onIssueCreated = onDocumentCreated("customers/{customerId}/issues/{issueId}", async (event) => {
  const data = event.data?.data();
  const customerId = event.params.customerId;
  if (!data) return;
  const customer = await db.collection("customers").doc(customerId).get();
  const title = `${customer.get("name") ?? "Customer"}: ${String(data.title ?? "Issue reported")}`;
  await sendToOwners("New line issue", title, {
    type: "issue",
    customerId,
  });
});

export const onVoiceCallWritten = onDocumentWritten("customers/{customerId}/calls/{callId}", async (event) => {
  const after = event.data?.after.data();
  const before = event.data?.before.data();
  const customerId = event.params.customerId;
  const callId = event.params.callId;
  const customerRef = db.collection("customers").doc(customerId);

  if (!after) {
    await customerRef.update({ callStatus: "idle", liveCallId: "", callRecording: false });
    return;
  }

  const status = String(after.status ?? "");
  const live = status === "ringing" || status === "in_call";
  await customerRef.update({
    callStatus: status,
    liveCallId: live ? callId : "",
    callRecording: after.recording === true && status === "in_call",
  });

  const justRinging = !before && status === "ringing";
  if (justRinging) {
    const customer = await customerRef.get();
    const name = String(customer.get("name") ?? "Customer");
    await sendToOwners("Incoming voice call", `${name} is calling the desk`, {
      type: "call",
      customerId,
      callId,
    });
    await customerRef.collection("chatMessages").add({
      from: "customer",
      text: "Voice call to the desk",
      kind: "call",
      callId,
      createdAtMs: Date.now(),
    });
    await ensureChatIssue(customerId, name, "call", "Customer called the desk to report an issue.");
  }

  const newRecordingUrl = typeof after.recordingUrl === "string" ? after.recordingUrl : "";
  const oldRecordingUrl = before && typeof before.recordingUrl === "string" ? before.recordingUrl : "";
  if (newRecordingUrl && newRecordingUrl !== oldRecordingUrl) {
    await customerRef.collection("chatMessages").add({
      from: "owner",
      text: "Call recording",
      kind: "call",
      mediaUrl: newRecordingUrl,
      durationMs: Number(after.durationMs ?? 0),
      callId,
      createdAtMs: Date.now(),
    });
  }
});
