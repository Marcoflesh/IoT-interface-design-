#!/usr/bin/env bash
# Ver desde la terminal que los datos están llegando a MariaDB (sin DBeaver).
#
#   bash scripts/fedora/ver-mariadb.sh            → una foto del estado
#   bash scripts/fedora/ver-mariadb.sh --seguir   → se actualiza cada 5 s (Ctrl+C para salir)
#
# Entra como el usuario de la app (DB_USER / DB_PASSWORD del .env), solo lectura.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
# shellcheck source=scripts/fedora/lib-mariadb.sh
source scripts/fedora/lib-mariadb.sh

[ -f .env ] || { echo "Falta .env"; exit 1; }
DB_NAME=$(leer_env DB_NAME); DB_NAME=${DB_NAME:-calidad_agua}
DB_USER=$(leer_env DB_USER); DB_USER=${DB_USER:-agua}
DB_HOST=$(leer_env DB_HOST); DB_HOST=${DB_HOST:-127.0.0.1}
DB_PORT=$(leer_env DB_PORT); DB_PORT=${DB_PORT:-3306}
export MYSQL_PWD
MYSQL_PWD=$(leer_env DB_PASSWORD)

consulta() { mariadb -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "$DB_NAME" --table -e "$1"; }

# Hora de México (UTC-6, sin horario de verano desde 2022). En la base todo está en UTC.
LOCAL="CONVERT_TZ(%s, '+00:00', '-06:00')"
printf -v FECHA_L "$LOCAL" "l.fecha"
printf -v ULTIMA_L "$LOCAL" "ultima_conexion"

foto() {
  echo "== Dispositivos (¿quién manda datos y hace cuánto?)"
  consulta "SELECT id AS dispositivo, IF(simulado, 'sí', 'no') AS simulado,
              DATE_FORMAT($ULTIMA_L, '%d/%m %H:%i:%s') AS ultima_lectura,
              CONCAT(segundos_sin_datos, ' s') AS hace, lecturas
            FROM estado_dispositivos WHERE lecturas > 0 ORDER BY ultima_conexion DESC;" || return 1

  echo "== Últimas 10 lecturas (hora de México) con el color del semáforo"
  consulta "SELECT l.id, DATE_FORMAT($FECHA_L, '%H:%i:%s') AS hora, l.dispositivo, l.origen,
              l.ph, l.turbidez AS ntu, l.conductividad AS 'µS/cm', l.temperatura AS '°C',
              CASE
                WHEN l.ph IS NULL OR l.turbidez IS NULL OR l.conductividad IS NULL THEN 'gris'
                WHEN (l.ph NOT BETWEEN 6.5 AND 8.5) + (l.turbidez > 4) + (l.conductividad NOT BETWEEN 50 AND 1500) = 0 THEN 'verde'
                WHEN (l.ph NOT BETWEEN 6.5 AND 8.5) + (l.turbidez > 4) + (l.conductividad NOT BETWEEN 50 AND 1500) = 1 THEN 'amarillo'
                ELSE 'rojo'
              END AS semaforo
            FROM lecturas l ORDER BY l.fecha DESC, l.id DESC LIMIT 10;"

  echo "== Última hora por dispositivo y origen"
  consulta "SELECT dispositivo, origen, COUNT(*) AS lecturas,
              ROUND(AVG(ph), 2) AS ph_prom, ROUND(AVG(turbidez), 1) AS ntu_prom,
              ROUND(AVG(conductividad), 0) AS ec_prom
            FROM lecturas WHERE fecha >= UTC_TIMESTAMP() - INTERVAL 1 HOUR
            GROUP BY dispositivo, origen ORDER BY lecturas DESC;"
}

if [ "${1:-}" = "--seguir" ]; then
  while true; do
    clear
    echo "MariaDB · $DB_NAME · $(date '+%H:%M:%S') · se actualiza cada 5 s (Ctrl+C para salir)"
    foto || { echo "No pude entrar como '$DB_USER'. Revisa DB_PASSWORD en .env."; exit 1; }
    sleep 5
  done
else
  foto || { echo "No pude entrar como '$DB_USER'. Revisa DB_PASSWORD en .env (o corre preparar-mariadb.sh)."; exit 1; }
fi
