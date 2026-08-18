# GlobalNetwork

Internet service in **Antigua**, billed in **East Caribbean dollars (EC$ / XCD)**.

Two identities only: the **owner** (`neuereatec@gmail.com`) on the web desk, and **customers** on iOS/Android.

- Marketing: https://bbscalton.github.io/globalnetwork/
- Owner desk: https://bbscalton.github.io/globalnetwork/ops/
- Android APK: https://globalnetwork-media.neuereatec.workers.dev/app/android.apk
- iOS IPA (unsigned CI build): https://github.com/bbscalton/globalnetwork/releases/latest/download/GlobalNetwork.ipa

Android customers can install the APK from the site. A stock iPhone will **not** install a website IPA; use TestFlight or the App Store for a normal install. The IPA is an unsigned archive for Xcode / a later signed upload.

## Local run

```bash
cd marketing && npm install && npm run dev
cd ops-web && npm install && npm run dev
cd functions && npm install && npm run build
```

Copy Firebase `VITE_FIREBASE_*` keys into `marketing/.env` and `ops-web/.env`.

`extendSubscription({ customerId, days, amountPaid, note })` grants extra days. If they pay less than the plan fee, status becomes `grace`.

## Flutter

In `customer-app/`, run `flutterfire configure`, then set `kFirebaseOptionsReady = true` in `lib/firebase_options.dart`.

GitHub Actions builds the Android APK (Ubuntu) and an unsigned iOS IPA (`macos-14`, `flutter build ios --no-codesign`) and attaches both to a GitHub Release. There are no Apple signing certificates in this repo.
