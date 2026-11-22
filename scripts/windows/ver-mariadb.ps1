# Ver desde PowerShell que los datos llegan a MariaDB (sin DBeaver).
#   powershell -ExecutionPolicy Bypass -File scripts\windows\ver-mariadb.ps1           → una foto
#   powershell -ExecutionPolicy Bypass -File scripts\windows\ver-mariadb.ps1 -Seguir   → cada 5 s (Ctrl+C)
param([switch]$Seguir)
. "$PSScriptRoot\lib.ps1"

$usuario = Get-EnvValor 'DB_USER' 'agua'
$clave = Get-EnvValor 'DB_PASSWORD'
$base = Get-EnvValor 'DB_NAME' 'calidad_agua'

# Hora de México (UTC-6); en la base todo está en UTC.
$consultas = @(
  @{ titulo = '== Dispositivos (¿quién manda datos y hace cuánto?)'; sql = @'
SELECT id AS dispositivo, IF(simulado, 'si', 'no') AS simulado,
       DATE_FORMAT(CONVERT_TZ(ultima_conexion, '+00:00', '-06:00'), '%d/%m %H:%i:%s') AS ultima_lectura,
       CONCAT(segundos_sin_datos, ' s') AS hace, lecturas
FROM estado_dispositivos WHERE lecturas > 0 ORDER BY ultima_conexion DESC;
'@ },
  @{ titulo = '== Últimas 10 lecturas (hora de México) con el color del semáforo'; sql = @'
SELECT l.id, DATE_FORMAT(CONVERT_TZ(l.fecha, '+00:00', '-06:00'), '%H:%i:%s') AS hora, l.dispositivo, l.origen,
       l.ph, l.turbidez AS ntu, l.conductividad AS ec_uScm, l.temperatura AS temp_C,
       CASE
         WHEN l.ph IS NULL OR l.turbidez IS NULL OR l.conductividad IS NULL THEN 'gris'
         WHEN (l.ph NOT BETWEEN 6.5 AND 8.5) + (l.turbidez > 4) + (l.conductividad NOT BETWEEN 50 AND 1500) = 0 THEN 'verde'
         WHEN (l.ph NOT BETWEEN 6.5 AND 8.5) + (l.turbidez > 4) + (l.conductividad NOT BETWEEN 50 AND 1500) = 1 THEN 'amarillo'
         ELSE 'rojo'
       END AS semaforo
FROM lecturas l ORDER BY l.fecha DESC, l.id DESC LIMIT 10;
'@ },
  @{ titulo = '== Última hora por dispositivo y origen'; sql = @'
SELECT dispositivo, origen, COUNT(*) AS lecturas, ROUND(AVG(ph), 2) AS ph_prom,
       ROUND(AVG(turbidez), 1) AS ntu_prom, ROUND(AVG(conductividad), 0) AS ec_prom
FROM lecturas WHERE fecha >= UTC_TIMESTAMP() - INTERVAL 1 HOUR
GROUP BY dispositivo, origen ORDER BY lecturas DESC;
'@ }
)

function Show-Foto {
  foreach ($c in $consultas) {
    Write-Host $c.titulo -ForegroundColor Cyan
    Invoke-MariaDB $c.sql $usuario $clave $base -Tabla
    if ($LASTEXITCODE -ne 0) {
      Write-Mal "No pude entrar como '$usuario'. ¿Está corriendo calidad-agua-db? ¿DB_PASSWORD es correcta?"
      exit 1
    }
  }
}

if ($Seguir) {
  while ($true) {
    Clear-Host
    Write-Host "MariaDB · $base · $(Get-Date -Format 'HH:mm:ss') · se actualiza cada 5 s (Ctrl+C para salir)"
    Show-Foto
    Start-Sleep -Seconds 5
  }
} else {
  Show-Foto
}
