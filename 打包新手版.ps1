$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dist = Join-Path $root "dist"
$staging = Join-Path $dist "QuantLife_Web_Starter"
$zip = Join-Path $dist "QuantLife_Web_Starter.zip"

$excludeNames = @(
  ".git",
  "node_modules",
  "backups",
  "dist",
  "fengdingding-progress.json",
  "fengdingding-progress.db",
  "fengdingding-progress.db-shm",
  "fengdingding-progress.db-wal",
  "llm-config.json",
  ".env",
  "settings.json",
  "settings.local.json"
)

if (Test-Path $dist) {
  New-Item -ItemType Directory -Path $dist -Force | Out-Null
} else {
  New-Item -ItemType Directory -Path $dist | Out-Null
}

if (Test-Path $staging) {
  Remove-Item -LiteralPath $staging -Recurse -Force
}
New-Item -ItemType Directory -Path $staging | Out-Null

Get-ChildItem -LiteralPath $root -Force | ForEach-Object {
  if ($excludeNames -contains $_.Name) {
    return
  }
  if ($_.Name -like "*.local-backup-*") {
    return
  }

  $destination = Join-Path $staging $_.Name
  if ($_.PSIsContainer) {
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse -Force
  } else {
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
  }
}

if (Test-Path $zip) {
  Remove-Item -LiteralPath $zip -Force
}

Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zip -Force

Write-Host ""
Write-Host "Package created:"
Write-Host $zip
Write-Host ""
Write-Host "Share this ZIP with users who do not use GitHub."
Write-Host "Do not add local llm-config.json, .env, database, or progress files."
