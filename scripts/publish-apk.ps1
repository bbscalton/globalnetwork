# Publish an APK to https://dl.neuereatec.org/globalnetwork/app/<Slot>.apk (Windows).
# Usage: $env:APK_UPLOAD_TOKEN = '<token>'; .\scripts\publish-apk.ps1 -Slot desk -File desk-app\app\build\outputs\apk\release\app-release.apk -Version 1.0.5
# Slots: android (customer), desk (owner desk; owner.apk alias), or per-client e.g. desk-acme. Token = GitHub secret APK_UPLOAD_TOKEN; never commit it.
param([Parameter(Mandatory)][string]$Slot, [Parameter(Mandatory)][string]$File, [string]$Version = '', [string]$Base = 'https://dl.neuereatec.org')
$ErrorActionPreference = 'Stop'
if (-not $env:APK_UPLOAD_TOKEN) { throw 'Set $env:APK_UPLOAD_TOKEN first' }
$sha = (Get-FileHash -Algorithm SHA256 $File).Hash.ToLower()
$h = @{ Authorization = "Bearer $($env:APK_UPLOAD_TOKEN)"; 'X-Sha256' = $sha; 'X-Version' = $Version }
$r = Invoke-RestMethod -Method Put -Uri "$Base/api/upload/$Slot" -Headers $h -InFile $File -ContentType 'application/vnd.android.package-archive'
$r | ConvertTo-Json
$tmp = New-TemporaryFile
Invoke-WebRequest -Uri "$Base/globalnetwork/app/$Slot.apk" -OutFile $tmp -UseBasicParsing
$got = (Get-FileHash -Algorithm SHA256 $tmp).Hash.ToLower(); Remove-Item $tmp
if ($got -ne $sha) { throw "verify failed: $got != $sha" }
"published $Base/globalnetwork/app/$Slot.apk sha256=$sha"
