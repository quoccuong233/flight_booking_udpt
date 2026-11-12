# Switches one PostgreSQL instance to its replica: stops the primary, promotes the replica and
# points that instance's services at it. Use when the primary is dead or must be taken down.
#   powershell -ExecutionPolicy Bypass -File scripts\failover.ps1                  (postgres-main)
#   powershell -ExecutionPolicy Bypass -File scripts\failover.ps1 -Cluster booking (postgres-booking)
# Undo later with scripts\failback.ps1 and the same -Cluster.
param([ValidateSet('main', 'booking')][string]$Cluster = 'main')

. (Join-Path $PSScriptRoot 'db-common.ps1')
Push-Location $Root

$c = $Clusters[$Cluster]
$primary = $c.Primary
$replicaName = $c.Replica
$services = $c.Services

$replica = Get-Recovery $replicaName
if ($replica -eq '') { Stop-WithError "$replicaName khong chay, khong the failover" }

if ($replica -eq 't') {
  Write-Step "Dung $($services -join ', ') va $primary"
  # Services first so nothing writes to the primary while it shuts down. A clean shutdown sends
  # every remaining change to the replica, so a planned switch loses no data.
  Invoke-Checked 'Dung service' { docker compose stop @services }
  docker compose stop $primary

  Write-Step "Nang $replicaName thanh database chinh"
  $promoted = docker exec $replicaName psql -U postgres -Atc 'SELECT pg_promote()'
  if ("$promoted".Trim() -ne 't') { Stop-WithError 'pg_promote() khong thanh cong' }
} else {
  Write-Host "$replicaName da la database chinh tu truoc, chi cap nhat cau hinh service."
}

Write-Step "Ghi $($c.HostVar)=$replicaName vao .env va khoi dong lai service"
Set-DbHost $c.HostVar $replicaName
Invoke-Checked 'Khoi dong service' { docker compose up -d --no-deps @services backup }

Write-Step 'Cho cac service healthy va Kong chuyen request duoc'
Wait-Healthy $services
Wait-Gateway

Write-Host ''
Write-Host "FAILOVER XONG: $($services -join ', ') dang chay tren $replicaName." -ForegroundColor Green
Write-Host "Luu y: hien khong con ban sao du phong. Dua $primary ve lam chinh bang scripts\failback.ps1 -Cluster $Cluster"
Pop-Location
