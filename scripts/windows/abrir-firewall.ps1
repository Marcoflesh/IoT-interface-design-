# Deja que el ESP32 llegue a tu compu por el puerto de la página (WEB_PUERTO del .env, 8080 si no lo cambiaste). Corre en PowerShell COMO ADMINISTRADOR:
#   powershell -ExecutionPolicy Bypass -File scripts\windows\abrir-firewall.ps1
. "$PSScriptRoot\lib.ps1"

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Write-Mal 'Necesito permisos de administrador.'
  Write-Info 'Clic derecho en PowerShell → "Ejecutar como administrador" y vuelve a correr este script.'
  exit 1
}

$Puerto = Get-EnvValor 'WEB_PUERTO' '8080'
$Nombre = "Calidad del Agua $Puerto"

# 1) Red en modo Privado (en Pública Windows bloquea conexiones entrantes)
$perfil = Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -eq 'Internet' } | Select-Object -First 1
if ($perfil -and "$($perfil.NetworkCategory)" -eq 'Public') {
  Write-Aviso "La red '$($perfil.Name)' está como Pública."
  $resp = Read-Host '¿Cambiarla a Privada? Hazlo solo si es tu casa o el hotspot de tu celular (s/n)'
  if ($resp -eq 's') {
    Set-NetConnectionProfile -InterfaceIndex $perfil.InterfaceIndex -NetworkCategory Private
    Write-Ok "Red '$($perfil.Name)' ahora es Privada"
  } else {
    Write-Aviso 'La dejé Pública: la regla se crea solo para redes Privadas, así que el ESP32 no entrará en esta red.'
  }
} elseif ($perfil) { Write-Ok "Red '$($perfil.Name)' en modo $($perfil.NetworkCategory)" }

# 2) Regla de entrada para el puerto, solo en redes Privadas
if (Get-NetFirewallRule -DisplayName $Nombre -ErrorAction SilentlyContinue) {
  Write-Ok "La regla '$Nombre' ya existía"
} else {
  New-NetFirewallRule -DisplayName $Nombre -Direction Inbound -Protocol TCP -LocalPort $Puerto -Action Allow -Profile Private | Out-Null
  Write-Ok "Regla creada: puerto TCP $Puerto abierto en redes Privadas"
}
Write-Info "Para quitarla después:  Remove-NetFirewallRule -DisplayName '$Nombre'"
