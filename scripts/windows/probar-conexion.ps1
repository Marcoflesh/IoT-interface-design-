# Revisa que todo funcione en Windows: Docker, contenedores, página, API, MariaDB, red y firewall.
#   powershell -ExecutionPolicy Bypass -File scripts\windows\probar-conexion.ps1
. "$PSScriptRoot\lib.ps1"
$Puerto = Get-EnvValor 'WEB_PUERTO' '8080'
$Base = "http://localhost:$Puerto"

Write-Host '== 1. Docker'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Mal 'No encuentro el comando docker.'
  Write-Info 'Instala Docker Desktop (WINDOWS.md, Paso 1) y ábrelo.'
  exit 1
}
if (-not (Test-Docker)) {
  Write-Mal 'Docker Desktop no está corriendo.'
  Write-Info 'Ábrelo desde el menú Inicio y espera a que diga "Engine running".'
  exit 1
}
Write-Ok "Docker funcionando ($((docker version --format '{{.Server.Version}}' 2>$null)))"

Write-Host '== 2. Contenedores'
foreach ($c in 'calidad-agua-db', 'calidad-agua-api', 'calidad-agua-web') {
  $estado = Get-EstadoContenedor $c
  if ($estado -eq 'running') { Write-Ok "$c corriendo" }
  elseif ($estado -eq '') { Write-Mal "No existe $c."; Write-Info 'docker compose up -d --build' }
  else {
    Write-Mal "$c está '$estado'. Últimas líneas de su log:"
    docker logs --tail 12 $c 2>&1 | ForEach-Object { Write-Host "      $_" }
  }
}

Write-Host '== 3. Página y API'
try {
  $r = Invoke-WebRequest $Base -UseBasicParsing -TimeoutSec 5
  Write-Ok "Página en $Base (HTTP $($r.StatusCode))"
} catch { Write-Mal "La página no responde en $Base." }

try {
  $s = Invoke-RestMethod "$Base/api/salud" -TimeoutSec 5
  if ($s.ok) { Write-Ok "API conectada a MariaDB ($($s.lecturas) lecturas)" } else { Write-Mal "API sin MariaDB: $($s.error)" }
} catch { Write-Mal 'La API no responde en /api/salud.'; Write-Info 'docker logs calidad-agua-api' }

$llave = Get-EnvValor 'ESP32_API_KEY'
$cuerpo = @{ dispositivo = 'prueba-terminal'; ph = 7.2; turbidez = 1.3; conductividad = 640; temperatura = 22.5 } | ConvertTo-Json
try {
  $r = Invoke-RestMethod "$Base/api/lecturas" -Method Post -ContentType 'application/json' -Headers @{ 'X-API-Key' = $llave } -Body $cuerpo -TimeoutSec 5
  Write-Ok "POST de prueba guardado (id $($r.id)), igual que lo hará el ESP32"
} catch {
  $codigo = 0; if ($_.Exception.Response) { $codigo = [int]$_.Exception.Response.StatusCode }
  Write-Mal "POST de prueba respondió $codigo."
  if ($codigo -eq 401) { Write-Info 'ESP32_API_KEY del .env no coincide con la de la API: docker compose up -d --force-recreate api' }
}
try {
  Invoke-RestMethod "$Base/api/lecturas" -Method Post -ContentType 'application/json' -Headers @{ 'X-API-Key' = 'llave-incorrecta-123456' } -Body '{"ph":7}' -TimeoutSec 5 | Out-Null
  Write-Mal 'Una llave incorrecta fue aceptada.'
} catch {
  $codigo = 0; if ($_.Exception.Response) { $codigo = [int]$_.Exception.Response.StatusCode }
  if ($codigo -eq 401) { Write-Ok 'Llave incorrecta rechazada (401)' } else { Write-Mal "Llave incorrecta dio $codigo (esperaba 401)." }
}

Write-Host '== 4. MariaDB (dentro de Docker)'
$usuario = Get-EnvValor 'DB_USER' 'agua'; $clave = Get-EnvValor 'DB_PASSWORD'; $base = Get-EnvValor 'DB_NAME' 'calidad_agua'
$ultima = Invoke-MariaDB "SELECT CONCAT(id, ' · ', fecha, ' UTC · pH ', ph, ' · ', dispositivo) FROM lecturas ORDER BY id DESC LIMIT 1;" $usuario $clave $base
if ($LASTEXITCODE -eq 0 -and $ultima) { Write-Ok "Última fila: $ultima" }
else { Write-Mal "No pude entrar a MariaDB como '$usuario'."; Write-Info 'Revisa DB_PASSWORD (si la cambiaste después del primer arranque, ver WINDOWS.md, Problemas).' }
$puerto = Get-EnvValor 'DB_PUERTO_LOCAL' '3306'
Write-Info "DBeaver: localhost, puerto $puerto, base $base, usuario $usuario"

Write-Host '== 5. Red para el ESP32'
$ip = Get-IpLocal
if ($ip) { Write-Ok "IP de esta compu: $ip  →  API_URL = `"http://${ip}:${Puerto}/api/lecturas`"" }
else { Write-Mal 'No encontré una red con salida (¿WiFi conectado?).' }
$perfil = Get-NetConnectionProfile -ErrorAction SilentlyContinue | Select-Object -First 1
if ($perfil -and "$($perfil.NetworkCategory)" -eq 'Public') {
  Write-Mal "Tu red '$($perfil.Name)' es Pública: Windows bloquea que el ESP32 entre."
  Write-Info 'Como administrador: powershell -ExecutionPolicy Bypass -File scripts\windows\abrir-firewall.ps1'
} elseif ($perfil) { Write-Ok "Red '$($perfil.Name)' en modo $($perfil.NetworkCategory)" }
$regla = Get-NetFirewallRule -DisplayName "Calidad del Agua $Puerto" -ErrorAction SilentlyContinue
if ($regla) { Write-Ok "Regla de firewall para el puerto $Puerto creada" }
else { Write-Aviso "No hay regla de firewall propia para el $Puerto (el ESP32 podría no entrar)."; Write-Info 'Como administrador: powershell -ExecutionPolicy Bypass -File scripts\windows\abrir-firewall.ps1' }

Write-Host ''
if ($script:Problemas -eq 0) {
  Write-Host 'Todo listo. Prueba desde tu celular (misma WiFi): ' -NoNewline; Write-Host "http://${ip}:${Puerto}/api/salud" -ForegroundColor Cyan
  Write-Host "Las lecturas de prueba quedaron con dispositivo = 'prueba-terminal'."
} else {
  Write-Host "$($script:Problemas) problema(s). Arregla el primero en rojo y vuelve a correr este script."
  exit 1
}
