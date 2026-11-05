# Makes postgres-main the primary again after scripts\failover.ps1:
#   1. stops the services so nothing is written
#   2. backs up the newest data from postgres-replica
#   3. restores that backup into postgres-main
#   4. rebuilds postgres-replica as a fresh copy of postgres-main
#   5. points every service back at postgres-main
#   powershell -ExecutionPolicy Bypass -File scripts\failback.ps1

. (Join-Path $PSScriptRoot 'db-common.ps1')
Push-Location $Root

if ((Get-Recovery 'postgres-replica') -ne 'f') {
  Stop-WithError 'postgres-replica khong phai database chinh, khong co gi de failback'
}

Write-Step '1/5 Dung 7 service'
Invoke-Checked 'Dung service' { docker compose stop @Services }

Write-Step '2/5 Sao luu du lieu moi nhat tu postgres-replica'
$output = docker compose exec -T backup sh /scripts/backup.sh
if ($LASTEXITCODE -ne 0) { Stop-WithError 'Sao luu that bai, service van dang dung. Chay lai scripts\failover.ps1 de bat lai.' }
$output | ForEach-Object { Write-Host $_ }
$match = [regex]::Match(($output -join "`n"), 'backup finished: /backups/(\S+) \(from postgres-replica\)')
if (-not $match.Success) { Stop-WithError 'Ban sao luu khong lay tu postgres-replica, dung lai de tranh mat du lieu' }
$stamp = $match.Groups[1].Value

Write-Step "3/5 Bat postgres-main va khoi phuc ban $stamp vao do"
Invoke-Checked 'Bat postgres-main' { docker compose up -d --no-deps postgres-main }
Wait-Healthy 'postgres-main'
foreach ($db in $Databases) {
  Invoke-Checked "Khoi phuc $db" { docker compose exec -T -e POSTGRES_HOST=postgres-main backup sh /scripts/restore.sh $stamp $db }
}

Write-Step '4/5 Dung lai postgres-replica thanh ban sao cua postgres-main'
# The replica clones through this slot; recreate it in case it was dropped.
docker exec postgres-main psql -U postgres -Atqc "SELECT pg_create_physical_replication_slot('replica1') WHERE NOT EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name = 'replica1')" | Out-Null
Invoke-Checked 'Xoa postgres-replica' { docker compose rm -sf postgres-replica }
Invoke-Checked 'Xoa volume cua replica' { docker volume rm flight-booking_postgres-replica-data }
Invoke-Checked 'Tao lai postgres-replica' { docker compose up -d --no-deps postgres-replica }
Wait-Healthy 'postgres-replica' 180
if ((Get-Recovery 'postgres-replica') -ne 't') { Stop-WithError 'postgres-replica chua o che do ban sao' }

Write-Step '5/5 Tro service ve postgres-main'
Set-PostgresHost ''
Invoke-Checked 'Khoi dong service' { docker compose up -d --no-deps @Services backup }
Wait-Healthy $Services
Wait-Gateway

Write-Host ''
Write-Host "FAILBACK XONG: postgres-main la database chinh, postgres-replica la ban sao. Du lieu lay tu ban $stamp." -ForegroundColor Green
Pop-Location
