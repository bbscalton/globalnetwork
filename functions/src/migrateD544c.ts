/**
 * Migration script for customer records from globalnetwork-d544c to globalnetwork-isp.
 * 
 * Background: During Sep 9-11, 2026, customers may have registered on the old
 * project globalnetwork-d544c. This script helps find and migrate those records.
 * 
 * USAGE:
 * 1. Ensure you have credentials for BOTH projects:
 *    - globalnetwork-d544c (source)
 *    - globalnetwork-isp (target)
 * 
 * 2. Set environment variables:
 *    export D544C_SERVICE_ACCOUNT=/path/to/globalnetwork-d544c-sa.json
 *    export ISP_SERVICE_ACCOUNT=/path/to/globalnetwork-isp-sa.json
 * 
 * 3. Run in dry-run mode first:
 *    npx ts-node src/migrateD544c.ts --dry-run
 * 
 * 4. Review the output, then run for real:
 *    npx ts-node src/migrateD544c.ts
 * 
 * DO NOT run this against production without Calton's explicit approval.
 * The dry-run mode will show what WOULD be migrated without making changes.
 */

import * as admin from "firebase-admin";

const DRY_RUN = process.argv.includes("--dry-run");
const VERBOSE = process.argv.includes("--verbose");

// Date range for the migration window (Sep 9-11, 2026)
const MIGRATION_START = Date.parse("2026-09-09T00:00:00-04:00");
const MIGRATION_END = Date.parse("2026-09-12T00:00:00-04:00");

interface MigrationResult {
  email: string;
  phone: string;
  name: string;
  sourceId: string;
  targetId: string | null;
  action: "merged" | "created" | "skipped" | "error";
  reason?: string;
}

async function main() {
  console.log("=".repeat(60));
  console.log("GlobalNetwork D544c → ISP Customer Migration");
  console.log("=".repeat(60));
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no changes)" : "LIVE"}`);
  console.log(`Migration window: Sep 9-11, 2026\n`);

  // Initialize source project (d544c)
  const d544cCredPath = process.env.D544C_SERVICE_ACCOUNT;
  const ispCredPath = process.env.ISP_SERVICE_ACCOUNT;

  if (!d544cCredPath || !ispCredPath) {
    console.error("ERROR: Set D544C_SERVICE_ACCOUNT and ISP_SERVICE_ACCOUNT environment variables.");
    console.error("\nExample:");
    console.error("  export D544C_SERVICE_ACCOUNT=/path/to/globalnetwork-d544c-sa.json");
    console.error("  export ISP_SERVICE_ACCOUNT=/path/to/globalnetwork-isp-sa.json");
    process.exit(1);
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const d544cCreds = require(d544cCredPath);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ispCreds = require(ispCredPath);

  const sourceApp = admin.initializeApp(
    { credential: admin.credential.cert(d544cCreds) },
    "source-d544c"
  );
  const targetApp = admin.initializeApp(
    { credential: admin.credential.cert(ispCreds) },
    "target-isp"
  );

  const sourceDb = admin.firestore(sourceApp);
  const targetDb = admin.firestore(targetApp);

  // Find customers created during the migration window
  console.log("Querying source project (globalnetwork-d544c)...");
  const sourceSnap = await sourceDb
    .collection("customers")
    .where("createdAtMs", ">=", MIGRATION_START)
    .where("createdAtMs", "<", MIGRATION_END)
    .get();

  console.log(`Found ${sourceSnap.docs.length} customer(s) from the migration window.\n`);

  if (sourceSnap.empty) {
    console.log("No customers to migrate.");
    return;
  }

  const results: MigrationResult[] = [];

  for (const doc of sourceSnap.docs) {
    const data = doc.data();
    const email = String(data.email ?? "").trim().toLowerCase();
    const phone = String(data.phone ?? "").trim();
    const name = String(data.name ?? "").trim();
    const uid = String(data.uid ?? "").trim();

    if (VERBOSE) {
      console.log(`\nProcessing: ${name} <${email}> (${doc.id})`);
    }

    const result: MigrationResult = {
      email,
      phone,
      name,
      sourceId: doc.id,
      targetId: null,
      action: "skipped",
    };

    try {
      // Check if customer already exists in target by email
      let targetSnap = await targetDb
        .collection("customers")
        .where("email", "==", email)
        .limit(1)
        .get();

      if (!targetSnap.empty) {
        const existing = targetSnap.docs[0];
        result.targetId = existing.id;

        // Check if we should merge (target has less data)
        const targetUid = String(existing.get("uid") ?? "").trim();
        const targetPaidUntil = Number(existing.get("paidUntilMs") ?? 0);
        const sourcePaidUntil = Number(data.paidUntilMs ?? 0);

        if (!targetUid && uid) {
          // Target doesn't have uid linked, source does - merge
          result.action = "merged";
          result.reason = "Added UID from source";

          if (!DRY_RUN) {
            await existing.ref.update({
              uid,
              migratedFromD544c: true,
              migratedAtMs: Date.now(),
              migratedSourceId: doc.id,
            });
          }
        } else if (sourcePaidUntil > targetPaidUntil) {
          // Source has more recent payment - merge payment data
          result.action = "merged";
          result.reason = "Updated paidUntilMs from source";

          if (!DRY_RUN) {
            await existing.ref.update({
              paidUntilMs: sourcePaidUntil,
              status: data.status ?? existing.get("status"),
              migratedFromD544c: true,
              migratedAtMs: Date.now(),
              migratedSourceId: doc.id,
            });
          }
        } else {
          result.action = "skipped";
          result.reason = "Target already has equal or better data";
        }
      } else {
        // No match by email, check by UID
        if (uid) {
          targetSnap = await targetDb
            .collection("customers")
            .where("uid", "==", uid)
            .limit(1)
            .get();

          if (!targetSnap.empty) {
            result.targetId = targetSnap.docs[0].id;
            result.action = "skipped";
            result.reason = "UID already linked to different email";
            results.push(result);
            continue;
          }
        }

        // Create new customer in target
        result.action = "created";

        if (!DRY_RUN) {
          const newRef = targetDb.collection("customers").doc();
          await newRef.set({
            ...data,
            migratedFromD544c: true,
            migratedAtMs: Date.now(),
            migratedSourceId: doc.id,
            orgId: "globalnetwork",
          });
          result.targetId = newRef.id;
        } else {
          result.targetId = "(would create new)";
        }
      }
    } catch (error) {
      result.action = "error";
      result.reason = error instanceof Error ? error.message : String(error);
    }

    results.push(result);
  }

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("MIGRATION RESULTS");
  console.log("=".repeat(60));

  const created = results.filter((r) => r.action === "created");
  const merged = results.filter((r) => r.action === "merged");
  const skipped = results.filter((r) => r.action === "skipped");
  const errors = results.filter((r) => r.action === "error");

  console.log(`\nCreated: ${created.length}`);
  for (const r of created) {
    console.log(`  - ${r.name} <${r.email}> → ${r.targetId}`);
  }

  console.log(`\nMerged: ${merged.length}`);
  for (const r of merged) {
    console.log(`  - ${r.name} <${r.email}> → ${r.targetId} (${r.reason})`);
  }

  console.log(`\nSkipped: ${skipped.length}`);
  for (const r of skipped) {
    console.log(`  - ${r.name} <${r.email}> (${r.reason})`);
  }

  if (errors.length > 0) {
    console.log(`\nErrors: ${errors.length}`);
    for (const r of errors) {
      console.log(`  - ${r.name} <${r.email}>: ${r.reason}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  if (DRY_RUN) {
    console.log("DRY RUN COMPLETE - No changes were made.");
    console.log("Run without --dry-run to apply changes.");
  } else {
    console.log("MIGRATION COMPLETE");
  }

  // Cleanup
  await sourceApp.delete();
  await targetApp.delete();
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
