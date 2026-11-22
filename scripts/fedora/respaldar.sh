#!/usr/bin/env bash
# Respaldo y restauración de la base de MariaDB local.
#
#   bash scripts/fedora/respaldar.sh                          → crea respaldos/<base>_AAAAMMDD_HHMMSS.sql.gz
#   bash scripts/fedora/respaldar.sh --restaurar <archivo>    → restaura ese respaldo (pide confirmación)
#
# Guarda los últimos 14 respaldos. La carpeta respaldos/ está en .gitignore.
set -euo pipefail

cd "$(dirname "$0")/../.." || exit 1
[ -f .env ] || { echo "Falta .env"; exit 1; }
# shellcheck source=scripts/fedora/lib-mariadb.sh
source scripts/fedora/lib-mariadb.sh
DB_NAME=$(leer_env DB_NAME)
DB_NAME=${DB_NAME:-calidad_agua}
[[ "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]] || { echo "DB_NAME inválido en .env"; exit 1; }

conectar_root

if [ "${1:-}" = "--restaurar" ]; then
  ARCHIVO=${2:?Indica el archivo: --restaurar respaldos/<archivo>.sql.gz}
  [ -f "$ARCHIVO" ] || { echo "No existe $ARCHIVO"; exit 1; }
  read -r -p "Esto REEMPLAZA la base '$DB_NAME' con $ARCHIVO. Escribe 'si' para continuar: " OK
  [ "$OK" = "si" ] || { echo "Cancelado."; exit 0; }
  gunzip -c "$ARCHIVO" | "${ROOT[@]}"
  echo "✓ Restaurado $ARCHIVO en '$DB_NAME'."
  exit 0
fi

mkdir -p respaldos
ARCHIVO="respaldos/${DB_NAME}_$(date +%Y%m%d_%H%M%S).sql.gz"
"${ROOT_DUMP[@]}" --single-transaction --routines --triggers --databases "$DB_NAME" | gzip > "$ARCHIVO"
echo "✓ Respaldo: $ARCHIVO ($(du -h "$ARCHIVO" | cut -f1))"

# Conservar solo los 14 más recientes
mapfile -t VIEJOS < <(ls -1t respaldos/"${DB_NAME}"_*.sql.gz | tail -n +15)
if [ "${#VIEJOS[@]}" -gt 0 ]; then
  rm -- "${VIEJOS[@]}"
  echo "  Borré ${#VIEJOS[@]} respaldo(s) viejo(s); quedan 14."
fi
echo "  Para restaurar: bash scripts/fedora/respaldar.sh --restaurar $ARCHIVO"
