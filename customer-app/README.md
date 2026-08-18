# GlobalNetwork customer app

Flutter app for subscribers on **web**, Android, and iOS. The owner manages accounts on the web desk (`/ops/`), not in this app.

Bundle IDs: Android `gn.globalnetwork.globalnetwork_customer`, iOS `gn.globalnetwork.globalnetworkCustomer`.

Web: https://bbscalton.github.io/globalnetwork/app/

## Setup

1. Run `flutterfire configure` in this folder (Firebase Auth, Firestore, Functions, Messaging), including a real **iOS** Firebase app — the current iOS options still reuse a web app id until that is done.
2. Set `kFirebaseOptionsReady = true` in `lib/firebase_options.dart`.
3. The owner must create your customer record **with the same Gmail** before you can see remaining days.
4. Tap **Continue with Google**, or register with email and password.

Google sign-in on **web** uses Firebase Auth `signInWithPopup` (same project `globalnetwork-isp`). Add **`bbscalton.github.io`** in Firebase Console → Authentication → Settings → Authorized domains if Google login fails with unauthorized-domain.

Google sign-in on Android uses the Firebase Android app `gn.globalnetwork.globalnetwork_customer` and the OAuth **Web** client as `serverClientId`. The website APK is signed with this machine’s Android debug keystore (already registered):

- SHA-1: `D1:47:8C:54:D2:CC:D3:2C:2E:EC:DF:DD:09:7B:FE:BB:F4:95:82:D0`
- SHA-256: `18:F3:9F:96:9E:F8:1A:06:95:95:13:F1:37:0B:FC:F7:FE:8B:B7:DA:02:07:44:6B:DF:0E:5E:0E:DA:51:F2:DC`

If you switch to a Play App Signing or a new upload key, add that SHA-1 (and SHA-256) in Firebase Console → Project settings → GlobalNetwork Customer.

## Install

- **Web:** https://bbscalton.github.io/globalnetwork/app/
- **Android:** download the APK from the marketing site and install (allow unknown sources if asked).
- **iPhone:** Apple will not install a raw IPA from a website on a stock iPhone. Use TestFlight (or the App Store) for a normal install. CI publishes an **unsigned** IPA on GitHub Releases for Xcode / archival only.

Ask the owner to extend days if you cannot pay the full fee. Chat and line-issue photos go straight to the desk. Voice notes and native camera are strongest on the phone apps; the web app supports text chat, file/photo pickers, home, and payment history.
