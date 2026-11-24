#!/usr/bin/env bash
# Prueba toda la cadena que usará el ESP32, sin guardar lecturas de prueba:
#   página → API → MariaDB, por localhost y por la IP de la red (la que usará el ESP32).
#
# Uso:  bash scripts/fedora/probar-conexion.sh
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 1
verde() { printf '\033[32m✓ %s\033[0m\n' "$1"; }
falla() { printf '\033[31m✕ %s\033[0m\n' "$1"; FALLAS=$((FALLAS + 1)); }
FALLAS=0

[ -f .env ] || { echo "Falta .env"; exit 1; }
# shellcheck source=scripts/fedora/lib-mariadb.sh
source scripts/fedora/lib-mariadb.sh
leer() { leer_env "$1"; }
KEY=$(leer ESP32_API_KEY)
DB_NAME=$(leer DB_NAME); DB_NAME=${DB_NAME:-calidad_agua}
DB_USER=$(leer DB_USER); DB_USER=${DB_USER:-agua}
DB_PASSWORD=$(leer DB_PASSWORD)

BASE=http://localhost:8080

# 1) Contenedores
if command -v docker >/dev/null; then
  for c in calidad-agua-web calidad-agua-api; do
    if [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = "true" ]; then verde "Contenedor $c corriendo"
    else falla "Contenedor $c no está corriendo → docker compose -f docker-compose.fedora.yml up -d --build"; fi
  done
fi

# 2) Página
if curl -fsS -o /dev/null "$BASE/"; then verde "Página en $BASE"; else falla "La página no responde en $BASE"; fi

# 3) API + MariaDB
SALUD=$(curl -sS "$BASE/api/salud" 2>/dev/null)
if echo "$SALUD" | grep -q '"ok":true'; then verde "API conectada a MariaDB: $SALUD"
else falla "API sin MariaDB: ${SALUD:-sin respuesta} → docker logs calidad-agua-api"; fi

# 4) La llave del .env (la misma que lleva el ESP32). Cuerpo vacío: la API revisa la llave
#    antes que los datos, así que 400 = llave buena y no se guarda nada; 401 = llave mala.
COD=$(curl -sS -o /tmp/respuesta-api.json -w '%{http_code}' -X POST "$BASE/api/lecturas" \
  -H "Content-Type: application/json" -H "X-API-Key: $KEY" -d '{}')
if [ "$COD" = "400" ]; then verde "La API acepta tu ESP32_API_KEY (prueba sin guardar nada)"
elif [ "$COD" = "401" ]; then falla "La API no acepta tu ESP32_API_KEY → docker compose -f docker-compose.fedora.yml up -d --force-recreate api"
else falla "POST respondió $COD: $(cat /tmp/respuesta-api.json 2>/dev/null)"; fi

# 5) Llave incorrecta debe rechazarse
COD=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/lecturas" \
  -H "Content-Type: application/json" -H "X-API-Key: llave-incorrecta-123456" -d '{"ph":7}')
if [ "$COD" = "401" ]; then verde "Llave incorrecta rechazada (401)"; else falla "Llave incorrecta dio $COD (esperaba 401)"; fi

# 6) Directo en MariaDB (lo mismo que verías en DBeaver)
ULTIMA=$(MYSQL_PWD="$DB_PASSWORD" mariadb -h 127.0.0.1 -u "$DB_USER" "$DB_NAME" -N -e \
  "SELECT CONCAT(id, ' · ', fecha, ' UTC · ', IFNULL(conductividad, '-'), ' µS/cm · ', IFNULL(temperatura, '-'), ' °C · ', origen)
   FROM lecturas ORDER BY fecha DESC, id DESC LIMIT 1" 2>&1)
if [[ "$ULTIMA" == *ERROR* ]]; then falla "No pude leer MariaDB: $ULTIMA"
elif [ -n "$ULTIMA" ]; then verde "Última lectura de esp32-1 en MariaDB: $ULTIMA"
else verde "MariaDB responde; todavía no hay lecturas del ESP32"; fi

# 7) Por la IP de la red (la dirección que usará el ESP32)
IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<NF;i++) if ($i=="src") print $(i+1)}')
if [ -n "$IP" ]; then
  if curl -fsS -o /dev/null --max-time 5 "http://$IP:8080/api/salud"; then verde "Responde en http://$IP:8080 (dirección para el ESP32)"
  else falla "No responde en http://$IP:8080: revisa firewalld (sudo firewall-cmd --list-ports)"; fi
fi

echo
if [ "$FALLAS" -eq 0 ]; then
  echo "Todo listo. En esp32/secretos.h usa:  API_URL = \"http://$IP:8080/api/lecturas\""
  echo "Prueba también desde tu celular (misma WiFi): http://$IP:8080/api/salud"
else
  echo "$FALLAS prueba(s) fallaron. Revisa la sección 'Problemas comunes' de FEDORA.md."
  exit 1
fi
