#!/usr/bin/env bash
# Prepara la MariaDB local de Fedora para el proyecto:
#   1) verifica que MariaDB esté corriendo
#   2) crea la base y el usuario con los datos de tu .env, con permisos mínimos
#      (la API solo puede leer, insertar y actualizar; no puede borrar ni crear tablas)
#   3) aplica las migraciones pendientes de api/migraciones (como administrador)
#   4) abre el puerto 8080 en el firewall para el ESP32
#   5) te dice qué poner en DBeaver y en secretos.h del ESP32
#
# Uso (desde la carpeta del repo):   bash scripts/fedora/preparar-mariadb.sh
# Se puede correr varias veces sin romper nada.
set -euo pipefail

cd "$(dirname "$0")/../.."
verde() { printf '\033[32m✓ %s\033[0m\n' "$1"; }
aviso() { printf '\033[33m! %s\033[0m\n' "$1"; }
error() { printf '\033[31m✕ %s\033[0m\n' "$1" >&2; exit 1; }

# ---------- .env ----------
[ -f .env ] || error "No existe .env. Corre: cp .env.example .env  y edítalo."
leer() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -e "s/^[\"']//" -e "s/[\"']$//" || true; }
DB_NAME=$(leer DB_NAME); DB_NAME=${DB_NAME:-calidad_agua}
DB_USER=$(leer DB_USER); DB_USER=${DB_USER:-agua}
DB_PASSWORD=$(leer DB_PASSWORD)
ESP32_API_KEY=$(leer ESP32_API_KEY)

[[ "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]] || error "DB_NAME solo puede tener letras, números y _."
[[ "$DB_USER" =~ ^[A-Za-z0-9_]+$ ]] || error "DB_USER solo puede tener letras, números y _."
[ -n "$DB_PASSWORD" ] || error "DB_PASSWORD está vacío en .env."
[ "$DB_PASSWORD" != "cambia-esta-clave" ] || error "Cambia DB_PASSWORD en .env (sigue el valor de ejemplo)."
[[ "$DB_PASSWORD" != *"'"* && "$DB_PASSWORD" != *'\'* ]] || error "DB_PASSWORD no puede llevar comillas simples ni diagonal invertida."
[ ${#ESP32_API_KEY} -ge 16 ] && [ "$ESP32_API_KEY" != "pega-aqui-una-llave-aleatoria" ] \
  || error "Pon una ESP32_API_KEY real (16+ caracteres) en .env:  python3 -c \"import secrets; print(secrets.token_hex(16))\""
verde ".env leído (base: $DB_NAME, usuario: $DB_USER)"

# ---------- 1) MariaDB corriendo ----------
command -v mariadb >/dev/null || error "No encuentro el cliente mariadb. Instala:  sudo dnf install mariadb-server"

# Acceso de administrador: en Fedora root entra con 'sudo mariadb' (unix_socket).
# Si tu root tiene contraseña, el script te la pedirá.
if [ "$(id -u)" -eq 0 ]; then ROOT=(mariadb -u root); else ROOT=(sudo mariadb -u root); fi
if ! "${ROOT[@]}" -e "SELECT 1" >/dev/null 2>&1; then
  if command -v systemctl >/dev/null && ! systemctl is-active --quiet mariadb; then
    aviso "MariaDB no está corriendo. Iniciándolo…"
    sudo systemctl enable --now mariadb
    sleep 2
  fi
  if ! "${ROOT[@]}" -e "SELECT 1" >/dev/null 2>&1; then
    aviso "root no entró sin contraseña. Escribe la contraseña de root de MariaDB:"
    ROOT=(mariadb -u root -p)
  fi
fi
verde "MariaDB responde ($("${ROOT[@]}" -N -e 'SELECT VERSION()'))"

if command -v ss >/dev/null && ! ss -tln | grep -qE '[:.]3306\s'; then
  aviso "MariaDB no escucha en el puerto TCP 3306 (¿skip-networking?). Revisa /etc/my.cnf.d/mariadb-server.cnf"
fi

# ---------- 2) Base y usuario con permisos mínimos ----------
# Se manda por stdin para que la contraseña no aparezca en la lista de procesos.
# REVOKE + GRANT deja los permisos exactos aunque antes tuviera ALL PRIVILEGES.
"${ROOT[@]}" <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
CREATE USER IF NOT EXISTS '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';
ALTER USER '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
ALTER USER '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';
REVOKE ALL PRIVILEGES, GRANT OPTION FROM '$DB_USER'@'localhost';
REVOKE ALL PRIVILEGES, GRANT OPTION FROM '$DB_USER'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, SHOW VIEW ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
GRANT SELECT, INSERT, UPDATE, SHOW VIEW ON \`$DB_NAME\`.* TO '$DB_USER'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
verde "Base '$DB_NAME' y usuario '$DB_USER' listos (solo desde esta computadora; leer, insertar y actualizar)"

# ---------- 3) Migraciones (como administrador) ----------
APLICADAS=$("${ROOT[@]}" -N "$DB_NAME" -e "SELECT version FROM schema_migraciones" 2>/dev/null || true)
for archivo in api/migraciones/[0-9][0-9][0-9]_*.sql; do
  version=$(basename "$archivo" | cut -c1-3)
  if grep -qx "$version" <<<"$APLICADAS"; then
    verde "Migración $(basename "$archivo") ya estaba aplicada"
  else
    "${ROOT[@]}" "$DB_NAME" < "$archivo"
    verde "Migración aplicada: $(basename "$archivo")"
  fi
done

# Comprobación entrando igual que la API (TCP 127.0.0.1, usuario de la app)
TOTAL=$(MYSQL_PWD="$DB_PASSWORD" mariadb -h 127.0.0.1 -P 3306 -u "$DB_USER" "$DB_NAME" -N -e "SELECT COUNT(*) FROM lecturas")
DISPOSITIVOS=$(MYSQL_PWD="$DB_PASSWORD" mariadb -h 127.0.0.1 -u "$DB_USER" "$DB_NAME" -N -e "SELECT GROUP_CONCAT(id) FROM dispositivos")
verde "El usuario '$DB_USER' entra por 127.0.0.1: $TOTAL lecturas, dispositivos: $DISPOSITIVOS"

# ---------- 4) Firewall para el ESP32 ----------
if command -v firewall-cmd >/dev/null && sudo firewall-cmd --state >/dev/null 2>&1; then
  ZONA=$(sudo firewall-cmd --get-default-zone)
  if sudo firewall-cmd --zone="$ZONA" --query-port=8080/tcp >/dev/null; then
    verde "Puerto 8080 ya abierto en firewalld (zona $ZONA)"
  else
    sudo firewall-cmd --permanent --zone="$ZONA" --add-port=8080/tcp >/dev/null
    sudo firewall-cmd --reload >/dev/null
    verde "Puerto 8080 abierto en firewalld (zona $ZONA) para que el ESP32 llegue a la API"
  fi
else
  aviso "firewalld no está activo: no hice cambios de firewall."
fi

# ---------- 5) Resumen ----------
IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<NF;i++) if ($i=="src") print $(i+1)}')
IP=${IP:-TU_IP}
cat <<FIN

──────────────── Listo ────────────────
DBeaver (Nueva conexión → MariaDB):
  Host: localhost   Puerto: 3306   Base: $DB_NAME
  Usuario: $DB_USER   Contraseña: la de DB_PASSWORD en .env

Terminal:
  mariadb -h 127.0.0.1 -u $DB_USER -p $DB_NAME     (lectura y consultas)
  sudo mariadb $DB_NAME                          (administrador: borrar, cambiar tablas)

Respaldo de la base:
  bash scripts/fedora/respaldar.sh

Siguiente paso, levantar la página y la API:
  docker compose -f docker-compose.fedora.yml up -d --build
  bash scripts/fedora/probar-conexion.sh

En esp32/secretos.h:
  API_URL = "http://$IP:8080/api/lecturas"
  API_KEY = (el valor de ESP32_API_KEY en .env)
FIN
