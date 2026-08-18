# GlobalNetwork customer app

Flutter iOS and Android app for subscribers. The owner manages accounts on the web desk.

Bundle IDs: Android `gn.globalnetwork.globalnetwork_customer`, iOS `gn.globalnetwork.globalnetworkCustomer`.

## Setup

1. Run `flutterfire configure` in this folder (Firebase Auth, Firestore, Functions, Messaging), including a real **iOS** Firebase app — the current iOS options still reuse a web app id until that is done.
2. Set `kFirebaseOptionsReady = true` in `lib/firebase_options.dart`.
3. The owner must create your customer record **with the same Gmail** before you can see remaining days.
4. On Android, tap **Continue with Google**, or register with email and password.

Google sign-in uses the Firebase Android app `gn.globalnetwork.globalnetwork_customer`. The debug keystore SHA-1 is already registered. If you switch to a Play App Signing key, add that SHA-1 in Firebase Project settings.

## Install

- **Android:** download the APK from the marketing site and install (allow unknown sources if asked).
- **iPhone:** Apple will not install a raw IPA from a website on a stock iPhone. Use TestFlight (or the App Store) for a normal install. CI publishes an **unsigned** IPA on GitHub Releases for Xcode / archival only.

Ask the owner to extend days if you cannot pay the full fee. Chat and line-issue photos go straight to the desk.
