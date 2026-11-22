# Prueba tu canal de ThingSpeak con los datos del .env.
#   powershell -ExecutionPolicy Bypass -File scripts\windows\probar-thingspeak.ps1            → lee el canal
#   powershell -ExecutionPolicy Bypass -File scripts\windows\probar-thingspeak.ps1 -Escribir  → además escribe una lectura
param([switch]$Escribir)
. "$PSScriptRoot\lib.ps1"
$Api = 'https://api.thingspeak.com'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$canal = Get-EnvValor 'THINGSPEAK_CHANNEL_ID'
$leer = Get-EnvValor 'THINGSPEAK_READ_KEY'
$escribir = Get-EnvValor 'THINGSPEAK_WRITE_KEY'

if ($canal -notmatch '^\d+$') { Write-Mal "THINGSPEAK_CHANNEL_ID debe ser el número del canal (está: '$canal')."; exit 1 }
Write-Ok "Channel ID: $canal"

if ($Escribir) {
  if ($escribir.Length -ne 16) { Write-Mal 'THINGSPEAK_WRITE_KEY debe tener 16 caracteres (pestaña API Keys).'; exit 1 }
  try {
    $r = Invoke-RestMethod "$Api/update?api_key=$escribir&field1=7.21&field2=1.3&field3=640&field4=22.5" -TimeoutSec 15
    if ("$r" -eq '0') { Write-Mal 'ThingSpeak respondió 0: pasaron menos de 15 s desde la última escritura. Espera y repite.'; exit 1 }
    Write-Ok "Escritura de prueba guardada: entry_id $r"
    Start-Sleep -Seconds 2
  } catch { Write-Mal "ThingSpeak no aceptó la escritura: $($_.Exception.Message)"; exit 1 }
}

$url = "$Api/channels/$canal/feeds.json?results=3"
if ($leer) { $url += "&api_key=$leer" }
try { $d = Invoke-RestMethod $url -TimeoutSec 15 }
catch { Write-Mal "No pude leer el canal: $($_.Exception.Message) (¿Channel ID correcto? ¿internet?)"; exit 1 }

if ("$d" -eq '-1') {
  Write-Mal 'El canal es privado y falta THINGSPEAK_READ_KEY (o es incorrecta).'
  Write-Info 'Ponla en el .env, o hazlo público: Sharing → Share channel view with everyone.'
  exit 1
}
$c = $d.channel
Write-Ok "Canal `"$($c.name)`" · field1=$($c.field1), field2=$($c.field2), field3=$($c.field3), field4=$($c.field4)"
$nombres = @("$($c.field1)", "$($c.field2)", "$($c.field3)", "$($c.field4)") | ForEach-Object { $_.ToLower() }
if (-not ($nombres[0] -like '*ph*' -and $nombres[1] -like '*turb*' -and $nombres[2] -like '*cond*' -and $nombres[3] -like '*temp*')) {
  Write-Aviso 'Revisa el orden: Field 1 pH, Field 2 Turbidez, Field 3 Conductividad, Field 4 Temperatura.'
}
$f = @($d.feeds)
if ($f.Count -eq 0 -or $null -eq $f[0]) { Write-Info 'Última entrada: ninguna todavía' }
else {
  $u = $f[-1]
  Write-Info "Última entrada: entry_id $($u.entry_id) · $($u.created_at) · pH $($u.field1) · $($u.field2) NTU · $($u.field3) µS/cm · $($u.field4) °C"
}
Write-Host ''
Write-Host 'Listo. Si esto funciona, el puente y la página pueden leer el canal.'
