# GlobalNetwork customer app (Flutter)

iOS + Android skeleton for subscribers.

## Screens
- Login / register (email + password)
- Home — days remaining, status, balance
- Chat with the service provider (Firestore)
- Report issue — camera photo uploaded to Cloudflare R2

## Setup
```bash
flutter pub get
dart run flutterfire_cli:flutterfire configure
```

Then in `lib/main.dart` set `firebaseReady = true`.

Staff must create a `customers/{id}` record whose `email` matches the signed-in user.
