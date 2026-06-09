# Register the acropolisOS /drop slash command on the Discord application.
#
#   .\scripts\register-discord-command.ps1 <BOT_TOKEN>
#
# Uses curl.exe (bundled with Windows 10/11) instead of Invoke-RestMethod.
# Discord's Cloudflare layer blocks the PowerShell/.NET HTTP client and returns
#   403 {"message":"internal network error","code":40333}
# (a Cloudflare block, NOT a token/permission error). curl.exe's TLS stack
# passes, and we send the proper "DiscordBot (...)" User-Agent Discord expects.
#
# Only the operator runs this — it sends the bot token to Discord's API, which
# is why it is a manual, human-run step. The Application ID is public.
param(
  [Parameter(Mandatory = $true)]
  [string]$BotToken,
  [string]$ApplicationId = '1511403608250388621'
)
$ErrorActionPreference = 'Stop'

# Compact JSON for the /drop command. Written to a temp file (ASCII, no BOM) so
# curl sends it byte-for-byte — avoids all shell quote/escape pain.
$json = '{"name":"drop","type":1,"description":"Drop a note or data into acropolisOS","options":[{"type":3,"name":"text","description":"What to drop in","required":true}]}'
$tmp  = Join-Path $env:TEMP 'acropolis-drop-cmd.json'
Set-Content -Path $tmp -Value $json -Encoding ascii -NoNewline

$curl = Join-Path $env:SystemRoot 'System32\curl.exe'
$uri  = "https://discord.com/api/v10/applications/$ApplicationId/commands"

try {
  $out = & $curl -sS -w "`n%{http_code}" -X POST $uri `
    -H "Authorization: Bot $BotToken" `
    -H "Content-Type: application/json" `
    -H "User-Agent: DiscordBot (https://acropolisos.castalia.one, 1.0)" `
    --data-binary "@$tmp"
} finally {
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}

$lines = ($out -split "`n")
$code  = $lines[-1].Trim()
$body  = ($lines[0..($lines.Count - 2)] -join "`n")

if ($code -eq '200' -or $code -eq '201') {
  Write-Host "OK - /drop registered (HTTP $code)" -ForegroundColor Green
  Write-Host $body
  Write-Host "Install the app to a server, then use: /drop text:<your message>  -> lands in raw_inbox."
} else {
  Write-Host "register failed (HTTP $code):" -ForegroundColor Red
  Write-Host $body
  if ($code -eq '40333' -or $body -match '40333') {
    Write-Host "Still Cloudflare-blocked. Your network/IP may be flagged - try another network/VPN, or register from a different machine." -ForegroundColor Yellow
  }
  exit 1
}
