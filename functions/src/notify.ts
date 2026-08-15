import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { db, sendToToken } from "./context";

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
    const customer = await db.collection("customers").doc(customerId).get();
    const from = String(data.from ?? "");
    const text = String(data.text ?? "").slice(0, 120);
    if (from === "staff") {
      await sendToToken(customer.get("fcmToken") as string | undefined, "GlobalNetwork", text || "New message from GlobalNetwork", {
        type: "chat",
        customerId,
      });
    } else {
      await customer.ref.update({
        unreadStaff: (Number(customer.get("unreadStaff") ?? 0) || 0) + 1,
      });
      const staff = await db.collection("staffProfiles").get();
      for (const s of staff.docs) {
        await sendToToken(s.get("fcmToken") as string | undefined, customer.get("name") as string, text || "Customer message", {
          type: "chat",
          customerId,
        });
      }
    }
  },
);

export const onIssueCreated = onDocumentCreated("customers/{customerId}/issues/{issueId}", async (event) => {
  const data = event.data?.data();
  const customerId = event.params.customerId;
  if (!data) return;
  const customer = await db.collection("customers").doc(customerId).get();
  const title = `${customer.get("name") ?? "Customer"}: ${String(data.title ?? "Issue reported")}`;
  const staff = await db.collection("staffProfiles").get();
  for (const s of staff.docs) {
    await sendToToken(s.get("fcmToken") as string | undefined, "New line issue", title, {
      type: "issue",
      customerId,
    });
  }
});
