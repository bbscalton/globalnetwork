# GlobalNetwork

Internet service in **Antigua**, billed in **East Caribbean dollars (EC$ / XCD)**.

Two identities only: the **owner** (`neuereatec@gmail.com`) on the web desk, and **customers** on web, iOS, and Android.

- Marketing: https://bbscalton.github.io/globalnetwork/
- Customer web app: https://bbscalton.github.io/globalnetwork/app/
- Owner desk: https://bbscalton.github.io/globalnetwork/ops/
- Field POS: https://bbscalton.github.io/globalnetwork/pos/
- Customer Android APK: https://globalnetwork-media.neuereatec.workers.dev/app/android.apk
- Owner desk Android APK: https://globalnetwork-media.neuereatec.workers.dev/app/desk.apk
- iOS IPA (unsigned CI build): https://github.com/bbscalton/globalnetwork/releases/latest/download/GlobalNetwork.ipa

Customers can use the browser app, or install the **customer** Android APK from the site. The **owner desk** APK is a separate app (`gn.globalnetwork.desk`) that wraps the live `/ops/` desk in a Chrome Trusted Web Activity — it does not replace the customer APK. A stock iPhone will **not** install a website IPA; use TestFlight or the App Store for a normal install. The IPA is an unsigned archive for Xcode / a later signed upload.

Google sign-in on the customer web app needs `bbscalton.github.io` in Firebase Console → Authentication → Settings → Authorized domains (same as the owner desk).

## QuickBooks Online (owner desk)

Settings → Desk → **QuickBooks Online** connects a company file via Intuit OAuth. Invoice/payment sync is not shipped yet; Connect stores tokens for later export.

### Intuit developer app

1. Create an app at [developer.intuit.com](https://developer.intuit.com/) → **Dashboard** → **Create an app** → QuickBooks Online.
2. Under **Keys & OAuth**, copy the **Client ID** and **Client Secret** (use Development keys for Sandbox, Production keys for live).
3. Add this **Redirect URI** exactly (trailing slash required):

   `https://bbscalton.github.io/globalnetwork/ops/`

4. Scopes: Accounting (`com.intuit.quickbooks.accounting`).

### Configure on the desk

1. Deploy Cloud Functions so `saveQboConfig` / `qboStartConnect` / `qboCompleteConnect` / `qboDisconnect` / `qboStatus` exist (`firebase deploy --only functions,firestore:rules`).
2. Sign in as owner → **Settings** → paste Client ID + Secret → choose Sandbox or Production → **Save QBO credentials**.
3. Click **Connect QuickBooks**, approve the company on Intuit, and wait for redirect back to `/ops/`. Status should show **Connected** with company name and realm ID.

Secrets live in Firestore `adminConfig/quickbooksOnline` (Admin SDK / Functions only; client rules deny reads).

## Local run

```bash
cd marketing && npm install && npm run dev
cd ops-web && npm install && npm run dev
cd pos-web && npm install && npm run dev
cd functions && npm install && npm run build
```

Copy Firebase `VITE_FIREBASE_*` keys into `marketing/.env`, `ops-web/.env`, and `pos-web/.env` (project ID `globalnetwork-isp`). Cloud Functions require the Firebase **Blaze** (pay-as-you-go) plan — Spark alone cannot deploy Gen2 Functions.

`extendSubscription({ customerId, days, amountPaid, note })` grants extra days. If they pay less than the plan fee, status becomes `grace`.

## Flutter

In `customer-app/`, run `flutterfire configure`, then set `kFirebaseOptionsReady = true` in `lib/firebase_options.dart`. GitHub Pages builds the Flutter web app into `/globalnetwork/app/`.

GitHub Actions builds the Android APK (Ubuntu) and an unsigned iOS IPA (`macos-14`, `flutter build ios --no-codesign`) and attaches both to a GitHub Release. There are no Apple signing certificates in this repo.

## Owner desk Android

`desk-app/` is a Chrome **Trusted Web Activity** around https://bbscalton.github.io/globalnetwork/ops/. Package id `gn.globalnetwork.desk` is separate from the customer app. Download: https://globalnetwork-media.neuereatec.workers.dev/app/desk.apk
