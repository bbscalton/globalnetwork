# GlobalNetwork Desk (Android)

WebView shell around the live owner desk:

https://gbnglobenetwork-sketch.github.io/globalnetwork/ops/

Package id is `gn.globalnetwork.desk` so it can sit next to the customer app
(`gn.globalnetwork.globalnetwork_customer`). Google sign-in opens in Chrome
Custom Tabs (not trapped inside the system WebView).

> Note: A Trusted Web Activity needs Digital Asset Links at
> `https://gbnglobenetwork-sketch.github.io/.well-known/assetlinks.json`. GitHub **Project**
> Pages only publish under `/globalnetwork/`, so TWA verification fails and the
> old launcher exited immediately. This app uses a WebView shell instead.

## Build

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat assembleRelease
```

The release APK is `app/build/outputs/apk/release/app-release.apk`
(armeabi-v7a + arm64-v8a + x86_64 for phones and emulators). Version 1.0.3 keeps
Google / Firebase OAuth inside an in-app WebView popup so sign-in can finish.
Without `key.properties` it is signed with this machine's Android debug keystore.

## Publish

Upload to R2 as `orgs/globalnetwork/app/globalnetwork-desk.apk`. The Worker
serves it at `/app/desk.apk`. Do not overwrite `/app/android.apk` (customer app).

```powershell
npx wrangler r2 object put globalnetwork-media/orgs/globalnetwork/app/globalnetwork-desk.apk --file app/build/outputs/apk/release/app-release.apk --content-type application/vnd.android.package-archive --remote
```
