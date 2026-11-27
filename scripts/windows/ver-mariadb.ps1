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
  @{ titulo = '== ESP32 (¿hace cuánto mandó datos?)'; sql = @'
SELECT id AS dispositivo,
       DATE_FORMAT(CONVERT_TZ(ultima_conexion, '+00:00', '-06:00'), '%d/%m %H:%i:%s') AS ultima_lectura,
       CONCAT(segundos_sin_datos, ' s') AS hace, lecturas
FROM estado_dispositivos WHERE lecturas > 0 ORDER BY ultima_conexion DESC;
'@ },
  @{ titulo = '== Últimas 10 lecturas (hora de México) · semáforo: verde 4/4, amarillo 3-2/4, rojo 1-0/4'; sql = @'
SELECT l.id, DATE_FORMAT(CONVERT_TZ(l.fecha, '+00:00', '-06:00'), '%H:%i:%s') AS hora, l.dispositivo, l.origen,
       l.ts_entry_id AS ts_entrada, l.ph, l.turbidez AS turb_pct, l.conductividad AS ec_uScm, l.temperatura AS temp_C, l.en_rango,
       CASE
         WHEN l.ph IS NULL OR l.turbidez IS NULL OR l.conductividad IS NULL OR l.temperatura IS NULL THEN 'gris'
         WHEN en_rango = 4 THEN 'verde'
         WHEN en_rango >= 2 THEN 'amarillo'
         ELSE 'rojo'
       END AS semaforo
FROM (SELECT *, (ph BETWEEN 6.5 AND 8.5) + (turbidez BETWEEN 0 AND 10)
              + (conductividad BETWEEN 50 AND 1500) + (temperatura BETWEEN 10 AND 40) AS en_rango
      FROM lecturas) l
ORDER BY l.fecha DESC, l.id DESC LIMIT 10;
'@ },
  @{ titulo = '== Última hora por dispositivo y origen'; sql = @'
SELECT dispositivo, origen, COUNT(*) AS lecturas, ROUND(AVG(ph), 2) AS ph_prom,
       ROUND(AVG(turbidez), 1) AS turb_prom, ROUND(AVG(conductividad), 0) AS ec_prom, ROUND(AVG(temperatura), 1) AS temp_prom
FROM lecturas WHERE fecha >= UTC_TIMESTAMP() - INTERVAL 1 HOUR
GROUP BY dispositivo, origen ORDER BY lecturas DESC;
'@ },
  @{ titulo = '== ¿Alguna lectura repetida? (debe salir vacío)'; sql = @'
SELECT ts_canal, ts_entry_id, COUNT(*) AS veces FROM lecturas
WHERE ts_entry_id IS NOT NULL GROUP BY ts_canal, ts_entry_id HAVING COUNT(*) > 1;
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
