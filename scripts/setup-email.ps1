# Turns on real email: saves a Gmail address and App Password to .env, restarts
# Notification and reports whether Gmail accepted the login.
#   powershell -ExecutionPolicy Bypass -File scripts\setup-email.ps1
# Messages have no Vietnamese accents because Windows PowerShell 5.1 misreads UTF-8 scripts.
param([string]$Address, [string]$AppPassword)

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env'
$noBom = New-Object System.Text.UTF8Encoding($false)

if (-not $Address) { $Address = Read-Host 'Gmail dung de gui thu' }
if (-not $AppPassword) {
  $secure = Read-Host 'App Password 16 ky tu (khi go se khong hien)' -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $AppPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
}

# Google displays the password in groups separated by spaces.
$AppPassword = $AppPassword -replace '\s', ''
if ($AppPassword.Length -ne 16) {
  Write-Host "App Password phai dung 16 ky tu, ban vua nhap $($AppPassword.Length) ky tu." -ForegroundColor Red
  exit 1
}

$source = if (Test-Path $envFile) { $envFile } else { Join-Path $root '.env.example' }
$lines = [Collections.Generic.List[string]]([IO.File]::ReadAllLines($source))
$settings = [ordered]@{
  MAIL_RELAY_HOST = 'smtp.gmail.com'
  MAIL_RELAY_PORT = '587'
  MAIL_RELAY_USER = $Address.Trim()
  MAIL_RELAY_PASS = $AppPassword
}
foreach ($key in $settings.Keys) {
  $line = "$key=$($settings[$key])"
  $index = $lines.FindIndex([Predicate[string]] { param($item) $item.StartsWith("$key=") })
  if ($index -ge 0) { $lines[$index] = $line } else { $lines.Add($line) }
}
[IO.File]::WriteAllLines($envFile, $lines, $noBom)
Write-Host 'Da luu cau hinh vao .env'

Push-Location $root
docker compose up -d --no-deps notification | Out-Null
$exitCode = $LASTEXITCODE
Pop-Location
if ($exitCode -ne 0) {
  Write-Host 'Khong khoi dong lai duoc Notification. Docker Desktop da bat chua?' -ForegroundColor Red
  exit 1
}

Write-Host 'Dang kiem tra dang nhap Gmail...'
$started = (Get-Date).ToUniversalTime().AddSeconds(-5).ToString('yyyy-MM-ddTHH:mm:ssZ')
for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
  Start-Sleep -Seconds 2
  $log = (docker logs --since $started notification) -join "`n"
  if ($log -match 'mail relay ready') {
    Write-Host 'Thanh cong: tu gio email se gui that. Hay dang ky bang email that de thu.' -ForegroundColor Green
    exit 0
  }
  if ($log -match '"err":"([^"]*)"[^\n]*mail relay unavailable') {
    Write-Host "Gmail tu choi: $($Matches[1])" -ForegroundColor Red
    Write-Host 'Kiem tra lai Gmail, App Password va xac minh 2 buoc roi chay lai script nay.' -ForegroundColor Red
    exit 1
  }
}
Write-Host 'Chua co ket qua. Xem them bang: docker compose logs notification' -ForegroundColor Yellow
exit 1
