# Respaldo y restauración de la MariaDB del contenedor.
#   powershell -ExecutionPolicy Bypass -File scripts\windows\respaldar.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\windows\respaldar.ps1 -Restaurar respaldos\<archivo>.sql.gz
# Guarda los últimos 14 en la carpeta respaldos\ (está en .gitignore).
param([string]$Restaurar = '')
. "$PSScriptRoot\lib.ps1"

$base = Get-EnvValor 'DB_NAME' 'calidad_agua'
$root = Get-EnvValor 'DB_ROOT_PASSWORD'
if ($base -notmatch '^[A-Za-z0-9_]+$') { Write-Mal 'DB_NAME inválido en .env.'; exit 1 }
if ((Get-EstadoContenedor 'calidad-agua-db') -ne 'running') { Write-Mal 'El contenedor calidad-agua-db no está corriendo (docker compose up -d).'; exit 1 }

if ($Restaurar) {
  if (-not (Test-Path -LiteralPath $Restaurar)) { Write-Mal "No existe $Restaurar"; exit 1 }
  $ok = Read-Host "Esto REEMPLAZA la base '$base' con $Restaurar. Escribe si para continuar"
  if ($ok -ne 'si') { Write-Host 'Cancelado.'; exit 0 }
  docker cp $Restaurar 'calidad-agua-db:/tmp/restaurar.sql.gz' | Out-Null
  docker exec -e "MYSQL_PWD=$root" calidad-agua-db sh -c 'gunzip -c /tmp/restaurar.sql.gz | mariadb -u root && rm /tmp/restaurar.sql.gz'
  if ($LASTEXITCODE -eq 0) { Write-Ok "Restaurado $Restaurar en '$base'." } else { Write-Mal 'Falló la restauración (¿DB_ROOT_PASSWORD correcta?).' }
  exit $LASTEXITCODE
}

New-Item -ItemType Directory -Force -Path (Join-Path $Raiz 'respaldos') | Out-Null
$nombre = "${base}_$(Get-Date -Format 'yyyyMMdd_HHmmss').sql.gz"
# El volcado se comprime dentro del contenedor y se copia tal cual (PowerShell 5.1 cambiaría la codificación con >).
docker exec -e "MYSQL_PWD=$root" calidad-agua-db sh -c "mariadb-dump -u root --single-transaction --routines --triggers --databases $base | gzip > /tmp/$nombre"
if ($LASTEXITCODE -ne 0) { Write-Mal 'Falló el respaldo (¿DB_ROOT_PASSWORD correcta?).'; exit 1 }
docker cp "calidad-agua-db:/tmp/$nombre" (Join-Path $Raiz "respaldos\$nombre") | Out-Null
docker exec calidad-agua-db rm "/tmp/$nombre" | Out-Null
$tam = [math]::Round((Get-Item (Join-Path $Raiz "respaldos\$nombre")).Length / 1KB, 1)
Write-Ok "Respaldo: respaldos\$nombre ($tam KB)"

$viejos = Get-ChildItem (Join-Path $Raiz 'respaldos') -Filter "${base}_*.sql.gz" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 14
if ($viejos) { $viejos | Remove-Item; Write-Info "Borré $(@($viejos).Count) respaldo(s) viejo(s); quedan 14." }
Write-Info "Para restaurar: powershell -ExecutionPolicy Bypass -File scripts\windows\respaldar.ps1 -Restaurar respaldos\$nombre"
