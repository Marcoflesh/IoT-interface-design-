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
DB_NAME=$(grep -E "^DB_NAME=" .env | tail -1 | cut -d= -f2- | sed -e "s/^[\"']//" -e "s/[\"']$//")
DB_NAME=${DB_NAME:-calidad_agua}
[[ "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]] || { echo "DB_NAME inválido en .env"; exit 1; }

if [ "$(id -u)" -eq 0 ]; then SUDO=(); else SUDO=(sudo); fi
DUMP=$(command -v mariadb-dump || command -v mysqldump)

if [ "${1:-}" = "--restaurar" ]; then
  ARCHIVO=${2:?Indica el archivo: --restaurar respaldos/<archivo>.sql.gz}
  [ -f "$ARCHIVO" ] || { echo "No existe $ARCHIVO"; exit 1; }
  read -r -p "Esto REEMPLAZA la base '$DB_NAME' con $ARCHIVO. Escribe 'si' para continuar: " OK
  [ "$OK" = "si" ] || { echo "Cancelado."; exit 0; }
  gunzip -c "$ARCHIVO" | "${SUDO[@]}" mariadb
  echo "✓ Restaurado $ARCHIVO en '$DB_NAME'."
  exit 0
fi

mkdir -p respaldos
ARCHIVO="respaldos/${DB_NAME}_$(date +%Y%m%d_%H%M%S).sql.gz"
"${SUDO[@]}" "$DUMP" --single-transaction --routines --triggers --databases "$DB_NAME" | gzip > "$ARCHIVO"
echo "✓ Respaldo: $ARCHIVO ($(du -h "$ARCHIVO" | cut -f1))"

# Conservar solo los 14 más recientes
mapfile -t VIEJOS < <(ls -1t respaldos/"${DB_NAME}"_*.sql.gz | tail -n +15)
if [ "${#VIEJOS[@]}" -gt 0 ]; then
  rm -- "${VIEJOS[@]}"
  echo "  Borré ${#VIEJOS[@]} respaldo(s) viejo(s); quedan 14."
fi
echo "  Para restaurar: bash scripts/fedora/respaldar.sh --restaurar $ARCHIVO"
