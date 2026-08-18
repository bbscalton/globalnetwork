# GlobalNetwork

Internet service in **Antigua**, billed in **East Caribbean dollars (EC$ / XCD)**.

Two identities only: the **owner** (`neuereatec@gmail.com`) on the web desk, and **customers** on web, iOS, and Android.

- Marketing: https://bbscalton.github.io/globalnetwork/
- Customer web app: https://bbscalton.github.io/globalnetwork/app/
- Owner desk: https://bbscalton.github.io/globalnetwork/ops/
- Customer Android APK: https://globalnetwork-media.neuereatec.workers.dev/app/android.apk
- Owner desk Android APK: https://globalnetwork-media.neuereatec.workers.dev/app/desk.apk
- iOS IPA (unsigned CI build): https://github.com/bbscalton/globalnetwork/releases/latest/download/GlobalNetwork.ipa

Customers can use the browser app, or install the **customer** Android APK from the site. The **owner desk** APK is a separate app (`gn.globalnetwork.desk`) that wraps the live `/ops/` desk in a Chrome Trusted Web Activity — it does not replace the customer APK. A stock iPhone will **not** install a website IPA; use TestFlight or the App Store for a normal install. The IPA is an unsigned archive for Xcode / a later signed upload.

Google sign-in on the customer web app needs `bbscalton.github.io` in Firebase Console → Authentication → Settings → Authorized domains (same as the owner desk).

## Local run

```bash
cd marketing && npm install && npm run dev
cd ops-web && npm install && npm run dev
cd functions && npm install && npm run build
```

Copy Firebase `VITE_FIREBASE_*` keys into `marketing/.env` and `ops-web/.env`.

`extendSubscription({ customerId, days, amountPaid, note })` grants extra days. If they pay less than the plan fee, status becomes `grace`.

## Flutter

In `customer-app/`, run `flutterfire configure`, then set `kFirebaseOptionsReady = true` in `lib/firebase_options.dart`. GitHub Pages builds the Flutter web app into `/globalnetwork/app/`.

GitHub Actions builds the Android APK (Ubuntu) and an unsigned iOS IPA (`macos-14`, `flutter build ios --no-codesign`) and attaches both to a GitHub Release. There are no Apple signing certificates in this repo.

## Owner desk Android

`desk-app/` is a Chrome **Trusted Web Activity** around https://bbscalton.github.io/globalnetwork/ops/. Package id `gn.globalnetwork.desk` is separate from the customer app. Download: https://globalnetwork-media.neuereatec.workers.dev/app/desk.apk
