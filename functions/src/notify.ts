import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { db, sendToOwners, sendToToken } from "./context";

const BOT_COOLDOWN_MS = 40_000;

function fromOwner(from: string): boolean {
  return from === "owner" || from === "staff";
}

function chatKind(data: { kind?: unknown; mediaUrl?: unknown }): string {
  const kind = String(data.kind ?? "text");
  if (kind === "voice" || kind === "video" || kind === "text") return kind;
  const url = String(data.mediaUrl ?? "").toLowerCase();
  if (url.includes("video") || url.includes(".mp4")) return "video";
  if (url.includes("voice") || url.includes(".m4a") || url.includes("audio")) return "voice";
  return "text";
}

function previewFor(kind: string, text: string): string {
  if (kind === "voice") return "Voice note";
  if (kind === "video") return "Video clip";
  return text.slice(0, 80) || "Chat message";
}

function botReply(opts: {
  name: string;
  kind: string;
  text: string;
  status: string;
  firstCover: boolean;
}): string {
  const who = opts.name.split(" ")[0] || "there";
  if (opts.kind === "voice") {
    return `${who}, I saved your voice note on the GlobalNetwork desk. A live agent will listen as soon as they take over this chat. Stay here — tell me if the line is fully down or just slow.`;
  }
  if (opts.kind === "video") {
    return `${who}, your video clip is on the desk so we can see what you are seeing. I will keep this chat until a live agent joins. If it is dark, send another clip facing the CPE lights.`;
  }
  const body = opts.text.toLowerCase();
  if (opts.status === "expired" || opts.status === "suspended" || body.includes("pay") || body.includes("bill")) {
    return `${who}, I have this. If the account is expired or on hold, paying the current cycle is what restores the line. A live agent can confirm once they take over. Leave this chat open.`;
  }
  if (body.includes("slow") || body.includes("down") || body.includes("outage") || body.includes("happen")) {
    return `${who}, logged. I am the desk bot covering until a GlobalNetwork agent takes over. Tell me: lights on the radio / router, and how long it has been like this.`;
  }
  if (opts.firstCover) {
    return `GlobalNetwork desk bot here. A live agent has not joined yet, so I will keep you company and log this. Send a voice note or a short clip of the problem if you can.`;
  }
  return `Got it — still on the desk. A live agent will take over this chat. Reply here rather than calling unless it is an emergency.`;
}

async function ensureChatIssue(customerId: string, name: string, kind: string, text: string): Promise<void> {
  const customerRef = db.collection("customers").doc(customerId);
  const customer = await customerRef.get();
  const existingId = String(customer.get("openChatIssueId") ?? "");
  if (existingId) {
    const ticket = await customerRef.collection("issues").doc(existingId).get();
    if (ticket.exists && String(ticket.get("status") ?? "") !== "resolved") return;
  }
  const title = kind === "voice" ? "Voice report from chat" : kind === "video" ? "Video report from chat" : "Reported in chat";
  const body =
    kind === "text"
      ? text.slice(0, 400)
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

export const expireSubscriptions = onSchedule("every 24 hours", async () => {
  const now = Date.now();
  const snap = await db.collection("customers").get();
  let flipped = 0;
  for (const doc of snap.docs) {
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
      await doc.ref.update({ status: next, lastExpireSweepMs: now });
      flipped += 1;
      const left = Math.ceil((paidUntil - now) / (24 * 60 * 60 * 1000));
      if (left <= 3) {
        await sendToToken(
          doc.get("fcmToken") as string | undefined,
          "GlobalNetwork",
          next === "expired" ? "Your internet subscription has expired." : "Your service is in a grace period.",
          { type: "expiry", customerId: doc.id },
        );
      }
    }
  }
  logger.info("expireSubscriptions", { scanned: snap.size, flipped });
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
    await sendToOwners(String(customer.get("name") ?? "Customer"), preview, {
      type: "chat",
      customerId,
    });

    const agentLive = customer.get("chatAgentLive") === true;
    const lastBot = Number(customer.get("lastBotReplyMs") ?? 0);
    if (agentLive) return;
    if (now - lastBot < BOT_COOLDOWN_MS && kind === "text") return;

    try {
      const problem =
        kind !== "text" ||
        /down|slow|outage|pay|bill|happen|issue|light|offline|lost|no internet|not working/i.test(text);
      if (problem) {
        await ensureChatIssue(customerId, String(customer.get("name") ?? "Customer"), kind, text);
      }
      const reply = botReply({
        name: String(customer.get("name") ?? "there"),
        kind,
        text,
        status: String(customer.get("status") ?? ""),
        firstCover: lastBot === 0,
      });
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
