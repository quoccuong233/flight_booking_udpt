# Switches the system to postgres-replica: stops postgres-main, promotes the replica and
# points every service at it. Use when postgres-main is dead or must be taken down.
#   powershell -ExecutionPolicy Bypass -File scripts\failover.ps1
# Undo later with scripts\failback.ps1.

. (Join-Path $PSScriptRoot 'db-common.ps1')
Push-Location $Root

$replica = Get-Recovery 'postgres-replica'
if ($replica -eq '') { Stop-WithError 'postgres-replica khong chay, khong the failover' }

if ($replica -eq 't') {
  Write-Step 'Dung 7 service va postgres-main'
  # Services first so nothing writes to main while it shuts down. A clean shutdown sends
  # every remaining change to the replica, so a planned switch loses no data.
  Invoke-Checked 'Dung service' { docker compose stop @Services }
  docker compose stop postgres-main

  Write-Step 'Nang postgres-replica thanh database chinh'
  $promoted = docker exec postgres-replica psql -U postgres -Atc 'SELECT pg_promote()'
  if ("$promoted".Trim() -ne 't') { Stop-WithError 'pg_promote() khong thanh cong' }
} else {
  Write-Host 'postgres-replica da la database chinh tu truoc, chi cap nhat cau hinh service.'
}

Write-Step 'Ghi POSTGRES_HOST=postgres-replica vao .env va khoi dong lai service'
Set-PostgresHost 'postgres-replica'
Invoke-Checked 'Khoi dong service' { docker compose up -d --no-deps @Services backup }

Write-Step 'Cho cac service healthy va Kong chuyen request duoc'
Wait-Healthy $Services
Wait-Gateway

Write-Host ''
Write-Host 'FAILOVER XONG: he thong dang chay tren postgres-replica.' -ForegroundColor Green
Write-Host 'Luu y: hien khong con ban sao du phong. Dua postgres-main ve lam chinh bang scripts\failback.ps1'
Pop-Location
