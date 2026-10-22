# GlobalNetwork Desk (Android)

WebView shell around the live owner desk:

https://bbscalton.github.io/globalnetwork/ops/

Package id is `gn.globalnetwork.desk` so it can sit next to the customer app
(`gn.globalnetwork.globalnetwork_customer`). Google sign-in completes inside an
in-app WebView popup. Push notifications use **native FCM** (Android WebView
cannot receive web push); the FCM token is bridged into ops-web for
`registerOwnerDevice`.

> Note: A Trusted Web Activity needs Digital Asset Links at
> `https://bbscalton.github.io/.well-known/assetlinks.json`. GitHub **Project**
> Pages only publish under `/globalnetwork/`, so TWA verification fails and the
> old launcher exited immediately. This app uses a WebView shell instead.

## Build

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat assembleRelease
```

The release APK is `app/build/outputs/apk/release/app-release.apk`
(armeabi-v7a + arm64-v8a + x86_64 for phones and emulators). Version 1.0.4 adds
native FCM push for owner alerts. Without `key.properties` it is signed with this
machine's Android debug keystore.

## Publish

Hosted on the VPS (since 2026-10-21): https://dl.neuereatec.org/globalnetwork/app/desk.apk
(`/app/owner.apk` is an alias). Per-client desk builds use their own slot, e.g. `desk-acme`
-> https://dl.neuereatec.org/globalnetwork/app/desk-acme.apk. Do not overwrite `android` (customer app).
Build locally (it must be signed with the same key as the installed desk app, or updates fail), then:

```powershell
$env:APK_UPLOAD_TOKEN = '<token>'   # same value as GitHub secret APK_UPLOAD_TOKEN
..\scripts\publish-apk.ps1 -Slot desk -File app\build\outputs\apk\release\app-release.apk -Version 1.0.x
```

The old Cloudflare copy (R2 `orgs/globalnetwork/app/globalnetwork-desk.apk` via the `globalnetwork-media` Worker) is a legacy fallback only.
