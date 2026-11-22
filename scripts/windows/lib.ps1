# Funciones compartidas por los scripts de Windows. Se cargan con:  . "$PSScriptRoot\lib.ps1"
# Compatibles con Windows PowerShell 5.1 (el que trae Windows) y PowerShell 7.

$ErrorActionPreference = 'Continue'
$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Raiz
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
$script:Problemas = 0

function Write-Ok([string]$Texto)   { Write-Host "✓ $Texto" -ForegroundColor Green }
function Write-Mal([string]$Texto)  { Write-Host "✕ $Texto" -ForegroundColor Red; $script:Problemas++ }
function Write-Aviso([string]$Texto){ Write-Host "! $Texto" -ForegroundColor Yellow }
function Write-Info([string]$Texto) { Write-Host "  → $Texto" }

# Lee una variable del .env con las mismas reglas que Docker Compose:
#   CLAVE=valor   ·   CLAVE=valor   # comentario   ·   CLAVE="va # lor"
function Get-EnvValor([string]$Clave, [string]$PorDefecto = '') {
  $archivo = Join-Path $Raiz '.env'
  if (-not (Test-Path -LiteralPath $archivo)) { return $PorDefecto }
  $valor = $null
  foreach ($linea in Get-Content -LiteralPath $archivo -Encoding UTF8) {
    $linea = $linea.TrimStart([char]0xFEFF)
    if ($linea -match ('^\s*' + [regex]::Escape($Clave) + '\s*=(.*)$')) { $valor = $Matches[1] }
  }
  if ($null -eq $valor) { return $PorDefecto }
  $valor = $valor.Trim()
  if ($valor -match '^"([^"]*)"') { $valor = $Matches[1] }
  elseif ($valor -match "^'([^']*)'") { $valor = $Matches[1] }
  else { $valor = ($valor -replace '\s+#.*$', '').Trim() }
  if ($valor -eq '') { return $PorDefecto }
  return $valor
}

# ¿Docker Desktop está corriendo?
function Test-Docker {
  docker info *> $null
  return ($LASTEXITCODE -eq 0)
}

# Estado de un contenedor ('' si no existe).
function Get-EstadoContenedor([string]$Nombre) {
  $estado = docker inspect -f '{{.State.Status}}' $Nombre 2>$null
  if ($LASTEXITCODE -ne 0) { return '' }
  return "$estado".Trim()
}

# Ejecuta SQL dentro del contenedor de MariaDB (no necesitas MariaDB instalado en Windows).
# El SQL va por la entrada estándar para no pelear con las comillas de PowerShell.
function Invoke-MariaDB([string]$Sql, [string]$Usuario, [string]$Clave, [string]$Base, [switch]$Tabla) {
  $argumentos = @('exec', '-i', '-e', "MYSQL_PWD=$Clave", 'calidad-agua-db', 'mariadb', '-u', $Usuario)
  if ($Tabla) { $argumentos += '--table' } else { $argumentos += '-N' }
  if ($Base) { $argumentos += $Base }
  $Sql | docker @argumentos
}

# IP de la compu en la red WiFi/Ethernet (la que usa el ESP32).
function Get-IpLocal {
  $conf = Get-NetIPConfiguration -ErrorAction SilentlyContinue |
    Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' } |
    Select-Object -First 1
  if ($conf) { return $conf.IPv4Address[0].IPAddress }
  return ''
}
