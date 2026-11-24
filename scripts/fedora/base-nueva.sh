#!/usr/bin/env bash
# Borra la base de MariaDB del proyecto y crea una NUEVA y VACÍA, lista para el ESP32 real.
#   1) te enseña qué hay en la base y pide que escribas su nombre para confirmar
#   2) apaga la API y el puente (si corren en Docker) para que nadie escriba mientras tanto
#   3) hace un respaldo de la base vieja en respaldos/ (por si acaso)
#   4) DROP DATABASE y la crea de nuevo con preparar-mariadb.sh (usuario, permisos y migraciones)
# Queda con 0 lecturas y un solo dispositivo: esp32-1.
#
# Uso (desde la carpeta del repo):   bash scripts/fedora/base-nueva.sh
#                                    bash scripts/fedora/base-nueva.sh --sin-respaldo
# Antes: pon en tu .env el Channel ID y la Read API Key del canal NUEVO de ThingSpeak.
set -euo pipefail

cd "$(dirname "$0")/../.."
# shellcheck source=scripts/fedora/lib-mariadb.sh
source scripts/fedora/lib-mariadb.sh
verde() { printf '\033[32m✓ %s\033[0m\n' "$1"; }
aviso() { printf '\033[33m! %s\033[0m\n' "$1"; }
error() { printf '\033[31m✕ %s\033[0m\n' "$1" >&2; exit 1; }

[ -f .env ] || error "No existe .env. Corre: cp .env.example .env  y edítalo."
DB_NAME=$(leer_env DB_NAME); DB_NAME=${DB_NAME:-calidad_agua}
[[ "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]] || error "DB_NAME solo puede tener letras, números y _."
CANAL=$(leer_env THINGSPEAK_CHANNEL_ID)
[[ "$CANAL" =~ ^[0-9]+$ ]] || aviso "THINGSPEAK_CHANNEL_ID no está en .env: el puente no va a arrancar hasta que lo pongas."

conectar_root
verde "MariaDB responde como root vía $MODO_ROOT"
# Para que respaldar.sh y preparar-mariadb.sh no vuelvan a pedir la contraseña.
[ -n "$ROOT_CLAVE" ] && export MARIADB_ROOT_CLAVE="$ROOT_CLAVE"

# ---------- 1) Qué se va a borrar ----------
EXISTE=$("${ROOT[@]}" -N -e "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '$DB_NAME'")
if [ "$EXISTE" = "1" ]; then
  echo "La base '$DB_NAME' tiene hoy:"
  "${ROOT[@]}" "$DB_NAME" --table -e \
    "SELECT dispositivo, origen, COUNT(*) AS lecturas FROM lecturas GROUP BY dispositivo, origen ORDER BY dispositivo" 2>/dev/null \
    || echo "  (sin tabla lecturas)"
  if [ -t 0 ]; then
    read -r -p "Se BORRA todo esto. Escribe el nombre de la base ($DB_NAME) para continuar: " OK
    [ "$OK" = "$DB_NAME" ] || { echo "Cancelado: no se borró nada."; exit 0; }
  else
    error "Sin terminal no puedo pedir confirmación. Córrelo tú desde la terminal."
  fi
else
  aviso "La base '$DB_NAME' no existe todavía: solo la creo."
fi

# ---------- 2) Que nadie escriba mientras tanto ----------
DETENIDOS=()
if command -v docker >/dev/null 2>&1; then
  for c in calidad-agua-puente calidad-agua-api; do
    if [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = "true" ]; then
      docker stop "$c" >/dev/null && DETENIDOS+=("$c")
    fi
  done
  [ ${#DETENIDOS[@]} -gt 0 ] && verde "Detuve: ${DETENIDOS[*]}"
fi

# ---------- 3) Respaldo ----------
if [ "$EXISTE" = "1" ] && [ "${1:-}" != "--sin-respaldo" ]; then
  bash scripts/fedora/respaldar.sh
fi

# ---------- 4) Borrar y crear ----------
if [ "$EXISTE" = "1" ]; then
  "${ROOT[@]}" -e "DROP DATABASE \`$DB_NAME\`;"
  verde "Base '$DB_NAME' borrada"
fi
bash scripts/fedora/preparar-mariadb.sh

TOTAL=$("${ROOT[@]}" -N "$DB_NAME" -e "SELECT COUNT(*) FROM lecturas")
DISP=$("${ROOT[@]}" -N "$DB_NAME" -e "SELECT GROUP_CONCAT(id) FROM dispositivos")
echo
verde "Base nueva '$DB_NAME': $TOTAL lecturas, dispositivo(s): $DISP"
cat <<FIN

Ahora levanta todo otra vez (la API y el puente toman el canal nuevo del .env):
  docker compose -f docker-compose.fedora.yml --profile thingspeak up -d --build --force-recreate
  bash scripts/fedora/probar-conexion.sh
  bash scripts/fedora/ver-mariadb.sh --seguir
FIN
