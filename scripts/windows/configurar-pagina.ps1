# Pone tu canal de ThingSpeak en la página publicada (docs\js\config.js) con los datos del .env.
#   powershell -ExecutionPolicy Bypass -File scripts\windows\configurar-pagina.ps1   → Channel ID + Read API Key
# Solo datos de LECTURA: la Write API Key nunca va en docs\ (es público).
. "$PSScriptRoot\lib.ps1"

$archivo = Join-Path $Raiz 'docs\js\config.js'
$canal = Get-EnvValor 'THINGSPEAK_CHANNEL_ID'
$leer = Get-EnvValor 'THINGSPEAK_READ_KEY'
$fuente = 'thingspeak'
if ($canal -notmatch '^\d+$') { Write-Mal 'THINGSPEAK_CHANNEL_ID en .env debe ser un número.'; exit 1 }
if (-not $leer) { Write-Mal 'Falta THINGSPEAK_READ_KEY en .env: el canal es privado y la página no podría leerlo.'; exit 1 }
if ($leer -notmatch '^[A-Za-z0-9]{16}$') { Write-Mal 'THINGSPEAK_READ_KEY debe tener 16 letras/números.'; exit 1 }

$texto = [System.IO.File]::ReadAllText($archivo)
$nuevo = [regex]::new('(\n  fuente: )"[a-z]+"').Replace($texto, "`${1}`"$fuente`"", 1)
$nuevo = [regex]::new('(channelId: )"[^"]*"').Replace($nuevo, "`${1}`"$canal`"", 1)
$nuevo = [regex]::new('(readApiKey: )"[^"]*"').Replace($nuevo, "`${1}`"$leer`"", 1)
if ($nuevo -notmatch "fuente: `"$fuente`"" -or $nuevo -notmatch "channelId: `"$canal`"") {
  Write-Mal "No reconocí el formato de $archivo; edítalo a mano."
  exit 1
}
[System.IO.File]::WriteAllText($archivo, $nuevo, (New-Object System.Text.UTF8Encoding $false))
$detalle = "fuente `"$fuente`""
if ($canal) { $detalle += ", canal $canal" }
if ($leer) { $detalle += ', con Read API Key' }
Write-Ok "docs\js\config.js: $detalle"
Write-Host ''
Write-Host 'Para publicarlo en GitHub Pages:'
Write-Host '  git add docs/js/config.js'
Write-Host '  git commit -m "Página: leer el canal de ThingSpeak"'
Write-Host '  git push'
Write-Host 'En 1 o 2 minutos: https://marcoflesh.github.io/IoT-interface-design-/'
