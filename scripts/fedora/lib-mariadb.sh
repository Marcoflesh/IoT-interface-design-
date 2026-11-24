#!/usr/bin/env bash
# shellcheck disable=SC2034  # ROOT, ROOT_DUMP y MODO_ROOT los usan los scripts que hacen source
# Funciones compartidas por los scripts de Fedora (se usa con: source scripts/fedora/lib-mariadb.sh).
#
# conectar_root: deja en ROOT (y ROOT_DUMP) el comando para entrar a MariaDB como administrador.
# Orden en que lo intenta:
#   1) DB_ROOT_PASSWORD del .env, si la pusiste      → mariadb -u root con esa contraseña
#   2) sudo mariadb (root por socket, lo normal en Fedora recién instalado)
#   3) te pide la contraseña de root de MariaDB UNA sola vez
# La contraseña viaja en MYSQL_PWD, no en la línea de comandos, y nunca se imprime.

# Lee una variable del .env sin ejecutarlo, con las mismas reglas que Docker Compose:
#   CLAVE=valor            → valor
#   CLAVE=valor   # nota   → valor     (comentario al final: lleva espacio antes del #)
#   CLAVE="va # lor"       → va # lor  (entre comillas el # es parte del valor)
leer_env() {
  local linea valor
  linea=$(grep -E "^[[:space:]]*$1[[:space:]]*=" .env 2>/dev/null | tail -1) || true
  valor=${linea#*=}
  valor=${valor%$'\r'}
  valor="${valor#"${valor%%[![:space:]]*}"}"
  case "$valor" in
    \"*) valor=${valor#\"}; valor=${valor%%\"*} ;;
    \'*) valor=${valor#\'}; valor=${valor%%\'*} ;;
    *)   valor=$(printf '%s' "$valor" | sed -E 's/[[:space:]]+#.*$//; s/[[:space:]]+$//') ;;
  esac
  printf '%s' "$valor"
}

# Explica el error de MariaDB en palabras y termina.
explicar_error_root() {
  local salida=$1
  printf '\033[31m✕ No pude entrar a MariaDB como root.\033[0m\n' >&2
  case "$salida" in
    *1045*)
      cat >&2 <<'TXT'
  Error 1045 (Access denied for user 'root'@'localhost'): MariaDB rechazó la contraseña de root.
  · Si te pidió "[sudo] password for <tu usuario>", esa es la de LINUX.
    La de MariaDB es la que pide "Contraseña de root de MariaDB" (la misma que usas en DBeaver para root).
  · Pruébala sola:  mariadb -u root -p -e "SELECT 1"
  · Si funciona, ponla en el .env como  DB_ROOT_PASSWORD=tu-clave  y vuelve a correr el script.
  · Si no la recuerdas, revisa "Olvidé la contraseña de root" en FEDORA.md.
TXT
      ;;
    *2002*|*"Can't connect"*)
      echo "  MariaDB no está corriendo:  sudo systemctl enable --now mariadb" >&2 ;;
    *1698*)
      echo "  root solo entra con sudo (unix_socket). Corre el script con un usuario que tenga sudo." >&2 ;;
    *)
      echo "  Detalle: $salida" >&2 ;;
  esac
  exit 1
}

conectar_root() {
  local clave salida
  # MARIADB_ROOT_CLAVE: la pasa base-nueva.sh a los scripts que llama, para no preguntar tres veces.
  clave=${MARIADB_ROOT_CLAVE:-$(leer_env DB_ROOT_PASSWORD)}
  ROOT_CLAVE=""
  case "$clave" in cambia-esta-clave-root|no-se-usa-en-fedora) clave="" ;; esac

  # 1) Contraseña en el .env
  if [ -n "$clave" ]; then
    ROOT=(env "MYSQL_PWD=$clave" mariadb -u root)
    ROOT_DUMP=(env "MYSQL_PWD=$clave" "$(command -v mariadb-dump || command -v mysqldump)" -u root)
    if salida=$("${ROOT[@]}" -e "SELECT 1" 2>&1); then MODO_ROOT="contraseña del .env"; ROOT_CLAVE=$clave; return 0; fi
    explicar_error_root "$salida"
  fi

  # 2) root por socket (sudo, o ya eres root)
  local SUDO=(sudo)
  [ "$(id -u)" -eq 0 ] && SUDO=()
  [ -t 0 ] || SUDO=(sudo -n)                 # sin terminal no esperamos a que sudo pregunte
  [ "$(id -u)" -eq 0 ] && SUDO=()
  if [ "${#SUDO[@]}" -gt 0 ] && [ -t 0 ]; then
    echo "Probando root por socket con sudo (si pide \"[sudo] password\", es la contraseña de tu usuario de LINUX)…"
  fi
  if salida=$("${SUDO[@]}" mariadb -u root -e "SELECT 1" 2>&1); then
    ROOT=("${SUDO[@]}" mariadb -u root)
    ROOT_DUMP=("${SUDO[@]}" "$(command -v mariadb-dump || command -v mysqldump)" -u root)
    MODO_ROOT="sudo (socket)"
    return 0
  fi

  # Sin terminal no se puede preguntar: explicar y salir en lugar de quedarse esperando.
  [ -t 0 ] || explicar_error_root "$salida"

  # 3) Pedir la contraseña una vez
  if command -v systemctl >/dev/null && [ -t 0 ] && ! systemctl is-active --quiet mariadb 2>/dev/null; then
    echo "MariaDB no está corriendo. Iniciándolo…"
    sudo systemctl enable --now mariadb && sleep 2
  fi
  printf 'Contraseña de root de MariaDB (la que usas en DBeaver para root, NO la de Linux): '
  read -rs clave
  echo
  [ -n "$clave" ] || explicar_error_root "1045 contraseña vacía"
  ROOT=(env "MYSQL_PWD=$clave" mariadb -u root)
  ROOT_DUMP=(env "MYSQL_PWD=$clave" "$(command -v mariadb-dump || command -v mysqldump)" -u root)
  if salida=$("${ROOT[@]}" -e "SELECT 1" 2>&1); then MODO_ROOT="contraseña escrita"; ROOT_CLAVE=$clave; return 0; fi
  explicar_error_root "$salida"
}
