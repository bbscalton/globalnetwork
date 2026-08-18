# GlobalNetwork Desk (Android)

Trusted Web Activity wrapper around the live owner desk:

https://bbscalton.github.io/globalnetwork/ops/

Package id is `gn.globalnetwork.desk` so it can sit next to the customer app
(`gn.globalnetwork.globalnetwork_customer`). Google sign-in uses Chrome, not
the system WebView.

## Build

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat assembleRelease
```

The release APK is `app/build/outputs/apk/release/app-release.apk` (arm64-v8a).
Without `key.properties` it is signed with this machine's Android debug keystore.

## Publish

Upload to R2 as `orgs/globalnetwork/app/globalnetwork-desk.apk`. The Worker
serves it at `/app/desk.apk`. Do not overwrite `/app/android.apk` (customer app).
