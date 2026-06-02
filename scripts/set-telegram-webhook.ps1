# Register (or re-register) the acropolisOS Telegram inbound webhook.
#
#   .\scripts\set-telegram-webhook.ps1 <BOT_TOKEN>
#
# The webhook SECRET is read from .env (TELEGRAM_WEBHOOK_SECRET) so it never has
# to be typed or pasted. Only the operator runs this — it sends the bot token to
# Telegram's API, which is why it is a manual, human-run step.
param(
  [Parameter(Mandatory = $true)]
  [string]$BotToken
)
$ErrorActionPreference = 'Stop'

$envPath = Join-Path $PSScriptRoot '..\.env'
if (-not (Test-Path $envPath)) { Write-Host "ERROR: .env not found at $envPath" -ForegroundColor Red; exit 1 }

$line = Get-Content $envPath | Where-Object { $_ -match '^TELEGRAM_WEBHOOK_SECRET=' } | Select-Object -First 1
if (-not $line) { Write-Host "ERROR: TELEGRAM_WEBHOOK_SECRET= not found in .env (run the secret step first)" -ForegroundColor Red; exit 1 }
$secret = ($line -replace '^TELEGRAM_WEBHOOK_SECRET=', '').Trim()

$webhookUrl = 'https://acropolisos.castalia.one/api/channels/telegram'

try {
  $resp = Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$BotToken/setWebhook" -Body @{ url = $webhookUrl; secret_token = $secret }
} catch {
  Write-Host "setWebhook request failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

if ($resp.ok) {
  Write-Host "OK - webhook set: $($resp.description)" -ForegroundColor Green
  Write-Host "Now send your bot a message, then ask Claude to check raw_inbox."
} else {
  Write-Host "Telegram returned: $($resp | ConvertTo-Json -Compress)" -ForegroundColor Yellow
  exit 1
}
