# Makes the original primary of one instance the primary again after scripts\failover.ps1:
#   1. stops that instance's services so nothing is written
#   2. backs up the newest data from the replica
#   3. restores that backup into the primary
#   4. rebuilds the replica as a fresh copy of the primary
#   5. points the services back at the primary
#   powershell -ExecutionPolicy Bypass -File scripts\failback.ps1                  (postgres-main)
#   powershell -ExecutionPolicy Bypass -File scripts\failback.ps1 -Cluster booking (postgres-booking)
param([ValidateSet('main', 'booking')][string]$Cluster = 'main')

. (Join-Path $PSScriptRoot 'db-common.ps1')
Push-Location $Root

$c = $Clusters[$Cluster]
$primary = $c.Primary
$replicaName = $c.Replica
$services = $c.Services

if ((Get-Recovery $replicaName) -ne 'f') {
  Stop-WithError "$replicaName khong phai database chinh, khong co gi de failback"
}

Write-Step "1/5 Dung $($services -join ', ')"
Invoke-Checked 'Dung service' { docker compose stop @services }

Write-Step "2/5 Sao luu du lieu moi nhat tu $replicaName"
$output = docker compose exec -T backup sh /scripts/backup.sh
if ($LASTEXITCODE -ne 0) { Stop-WithError "Sao luu that bai, service van dang dung. Chay lai scripts\failover.ps1 -Cluster $Cluster de bat lai." }
$output | ForEach-Object { Write-Host $_ }
# backup.sh ends with: backup finished: /backups/<stamp> (from main=<host> booking=<host>)
$match = [regex]::Match(($output -join "`n"), "backup finished: /backups/(\S+) \(from[^)]* $Cluster=$replicaName[ )]")
if (-not $match.Success) { Stop-WithError "Ban sao luu khong lay tu $replicaName, dung lai de tranh mat du lieu" }
$stamp = $match.Groups[1].Value

Write-Step "3/5 Bat $primary va khoi phuc ban $stamp vao do"
Invoke-Checked "Bat $primary" { docker compose up -d --no-deps $primary }
Wait-Healthy $primary
foreach ($db in $c.Databases) {
  Invoke-Checked "Khoi phuc $db" { docker compose exec -T -e "$($c.HostVar)=$primary" backup sh /scripts/restore.sh $stamp $db }
}

Write-Step "4/5 Dung lai $replicaName thanh ban sao cua $primary"
# The replica clones through this slot; recreate it in case it was dropped.
docker exec $primary psql -U postgres -Atqc "SELECT pg_create_physical_replication_slot('replica1') WHERE NOT EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name = 'replica1')" | Out-Null
Invoke-Checked "Xoa $replicaName" { docker compose rm -sf $replicaName }
Invoke-Checked 'Xoa volume cua replica' { docker volume rm "flight-booking_$($replicaName)-data" }
Invoke-Checked "Tao lai $replicaName" { docker compose up -d --no-deps $replicaName }
Wait-Healthy $replicaName 180
if ((Get-Recovery $replicaName) -ne 't') { Stop-WithError "$replicaName chua o che do ban sao" }

Write-Step "5/5 Tro service ve $primary"
Set-DbHost $c.HostVar ''
Invoke-Checked 'Khoi dong service' { docker compose up -d --no-deps @services backup }
Wait-Healthy $services
Wait-Gateway

Write-Host ''
Write-Host "FAILBACK XONG: $primary la database chinh, $replicaName la ban sao. Du lieu lay tu ban $stamp." -ForegroundColor Green
Pop-Location
