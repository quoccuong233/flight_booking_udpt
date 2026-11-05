# Helpers shared by failover.ps1 and failback.ps1. Not meant to be run on its own.
# Messages have no Vietnamese accents because Windows PowerShell 5.1 misreads UTF-8 scripts.

$Root = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $Root '.env'
$Services = 'auth', 'flight', 'search-1', 'search-2', 'booking', 'payment', 'notification'
$Databases = 'auth', 'flight', 'search', 'booking', 'payment', 'notification'
$EnvMarker = '# Set by scripts/failover.ps1'

function Write-Step([string]$Message) {
  Write-Host ''
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Stop-WithError([string]$Message) {
  Write-Host "LOI: $Message" -ForegroundColor Red
  Pop-Location
  exit 1
}

# Runs a native command and stops the script when it fails.
function Invoke-Checked([string]$Description, [scriptblock]$Command) {
  & $Command
  if ($LASTEXITCODE -ne 0) { Stop-WithError "$Description that bai (exit code $LASTEXITCODE)" }
}

# 't' = standby, 'f' = accepts writes, '' = not reachable.
function Get-Recovery([string]$Container) {
  $result = docker exec $Container psql -U postgres -Atc 'SELECT pg_is_in_recovery()' 2>$null
  if ($LASTEXITCODE -ne 0) { return '' }
  return "$result".Trim()
}

function Wait-Healthy([string[]]$Containers, [int]$TimeoutSeconds = 120) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ($true) {
    $pending = @($Containers | Where-Object {
      (docker inspect -f '{{.State.Health.Status}}' $_ 2>$null) -ne 'healthy'
    })
    if ($pending.Count -eq 0) { return }
    if ((Get-Date) -gt $deadline) { Stop-WithError "Qua $TimeoutSeconds giay ma chua healthy: $($pending -join ', ')" }
    Start-Sleep -Seconds 2
  }
}

# Docker may call a service healthy before Kong does: Kong marked it down while it was
# stopped and needs two passing checks 5 seconds apart. Wait until the API answers through Kong.
function Wait-Gateway([int]$TimeoutSeconds = 60) {
  $checks = @{ '/api/search/suggestions' = 200; '/api/bookings' = 401; '/api/payments/00000000-0000-0000-0000-000000000000' = 401 }
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ($true) {
    $failing = @($checks.Keys | Where-Object {
      $path = $_
      try { $status = (Invoke-WebRequest "http://localhost:8000$path" -UseBasicParsing -TimeoutSec 5).StatusCode }
      catch { $status = [int]$_.Exception.Response.StatusCode }
      $status -ne $checks[$path]
    })
    if ($failing.Count -eq 0) { return }
    if ((Get-Date) -gt $deadline) { Stop-WithError "Kong chua chuyen duoc request toi: $($failing -join ', ')" }
    Start-Sleep -Seconds 2
  }
}

# Writes POSTGRES_HOST to .env, or removes it when $Value is empty.
function Set-PostgresHost([string]$Value) {
  $lines = @()
  if (Test-Path $EnvFile) {
    $lines = @([IO.File]::ReadAllLines($EnvFile) | Where-Object {
      $_ -notmatch '^POSTGRES_HOST=' -and -not $_.StartsWith($EnvMarker)
    })
  }
  while ($lines.Count -gt 0 -and $lines[-1].Trim() -eq '') { $lines = @($lines[0..($lines.Count - 2)]) }
  if ($Value) {
    $lines += ''
    $lines += "$EnvMarker on $(Get-Date -Format 'yyyy-MM-dd HH:mm'). Undo with scripts/failback.ps1."
    $lines += "POSTGRES_HOST=$Value"
  }
  [IO.File]::WriteAllLines($EnvFile, [string[]]$lines, (New-Object System.Text.UTF8Encoding($false)))
  # A value left in this shell would override .env for docker compose.
  Remove-Item Env:POSTGRES_HOST -ErrorAction SilentlyContinue
}
