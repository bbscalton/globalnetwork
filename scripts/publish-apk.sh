#!/usr/bin/env bash
# Publish an APK to the VPS download host (https://dl.neuereatec.org/globalnetwork/app/<slot>.apk).
# Usage: APK_UPLOAD_TOKEN=... scripts/publish-apk.sh <slot> <file.apk> [version]
#   slot: android (customer app), desk (owner desk; owner.apk is an alias), or a per-client slot like desk-acme  ([a-z0-9-], max 40)
# The token is the GitHub secret APK_UPLOAD_TOKEN (server copy: apps-server /srv/downloads/secrets/upload.token). Never commit it.
set -euo pipefail
slot="${1:?slot}"; file="${2:?apk file}"; version="${3:-}"
: "${APK_UPLOAD_TOKEN:?set APK_UPLOAD_TOKEN}"
base="${APK_UPLOAD_BASE:-https://dl.neuereatec.org}"
sha=$(sha256sum "$file" | cut -c1-64)
resp=$(curl -fsS --retry 3 -X PUT "$base/api/upload/$slot" \
  -H "Authorization: Bearer $APK_UPLOAD_TOKEN" -H "X-Sha256: $sha" -H "X-Version: $version" \
  -H "Content-Type: application/vnd.android.package-archive" --data-binary @"$file")
echo "$resp"
got=$(curl -fsSL "$base/globalnetwork/app/$slot.apk" | sha256sum | cut -c1-64)
[ "$got" = "$sha" ] || { echo "verify failed: $got != $sha" >&2; exit 1; }
echo "published $base/globalnetwork/app/$slot.apk sha256=$sha"
