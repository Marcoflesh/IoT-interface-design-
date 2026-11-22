#!/usr/bin/env bash
# ¿Por qué no abre http://localhost:8080? Revisa Docker, contenedores, puerto, página, API y SELinux,
# y dice qué hacer en cada caso. No cambia nada.
#
# Uso:  bash scripts/fedora/diagnosticar.sh
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

ok()   { printf '\033[32m✓ %s\033[0m\n' "$1"; }
mal()  { printf '\033[31m✕ %s\033[0m\n' "$1"; PROBLEMAS=$((PROBLEMAS + 1)); }
info() { printf '  → %s\n' "$1"; }
PROBLEMAS=0
COMPOSE=(docker compose -f docker-compose.fedora.yml)

echo "== 1. Docker"
if ! command -v docker >/dev/null; then
  mal "Docker no está instalado."
  info "Sigue FEDORA.md, Paso 1."
  exit 1
fi
VERSION=$(docker --version 2>&1)
if [[ "$VERSION" == *podman* || "$VERSION" == *Podman* ]]; then
  mal "El comando 'docker' es Podman ($VERSION)."
  info "Instala Docker Engine (FEDORA.md, Paso 1); con Podman la red 'host' y compose se comportan distinto."
fi
if ! SALIDA=$(docker info 2>&1); then
  if [[ "$SALIDA" == *"permission denied"* ]]; then
    mal "Tu usuario no puede usar Docker."
    info "sudo usermod -aG docker \$USER   y luego cierra sesión y vuelve a entrar."
  else
    mal "El servicio de Docker no está corriendo."
    info "sudo systemctl enable --now docker"
  fi
  exit 1
fi
SO=$(docker info --format '{{.OperatingSystem}}' 2>/dev/null)
OPCIONES=$(docker info --format '{{json .SecurityOptions}}' 2>/dev/null)
CONTEXTO=$(docker context show 2>/dev/null)
if [[ "$OPCIONES" == *rootless* ]]; then
  mal "Docker está en modo ROOTLESS (contexto: ${CONTEXTO:-?})."
  info "En rootless, network_mode host NO es la red de tu Fedora: la página no aparece en tu localhost:8080"
  info "y la API no ve tu MariaDB en 127.0.0.1:3306. Usa el Docker normal (con permisos de sistema):"
  info "  sudo systemctl enable --now docker"
  info "  systemctl --user disable --now docker docker.socket 2>/dev/null; docker context use default"
  info "  unset DOCKER_HOST   (y bórralo de ~/.bashrc si ahí lo pusiste)"
  info "  sudo usermod -aG docker \$USER  → cierra sesión, entra y repite:  ${COMPOSE[*]} up -d --build"
elif [[ "$SO" == *"Docker Desktop"* ]]; then
  mal "Estás usando Docker Desktop ($SO)."
  info "Docker Desktop corre en una máquina virtual: con network_mode host la página no queda en el localhost de Fedora"
  info "ni la API llega a tu MariaDB. Usa Docker Engine (puede convivir con Desktop):"
  info "  ${COMPOSE[*]} down                       (apaga lo que corre en Desktop)"
  info "  sudo dnf install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin"
  info "  sudo systemctl enable --now docker && sudo usermod -aG docker \$USER   → cierra sesión y entra"
  info "  docker context use default   y luego   ${COMPOSE[*]} up -d --build"
  info "  Si Docker Desktop se abre solo al iniciar, vuelve a cambiar el contexto: revisa con  docker context show"
else
  ok "Docker Engine funcionando ($(docker version --format '{{.Server.Version}}' 2>/dev/null), contexto ${CONTEXTO:-default})"
fi

echo "== 2. Contenedores"
for c in calidad-agua-web calidad-agua-api; do
  ESTADO=$(docker inspect -f '{{.State.Status}}|{{.RestartCount}}' "$c" 2>/dev/null)
  if [ -z "$ESTADO" ]; then
    mal "No existe el contenedor $c."
    info "Levántalo:  ${COMPOSE[*]} up -d --build"
  elif [[ "$ESTADO" == running* ]] && [ "${ESTADO#*|}" -lt 3 ]; then
    ok "$c corriendo"
  else
    mal "$c está '${ESTADO%|*}' (reinicios: ${ESTADO#*|}). Últimas líneas de su log:"
    docker logs --tail 15 "$c" 2>&1 | sed 's/^/      /'
  fi
done

for c in calidad-agua-web calidad-agua-api; do
  RED=$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$c" 2>/dev/null)
  if [ -n "$RED" ] && [ "$RED" != "host" ]; then
    mal "$c usa la red '$RED', no la del equipo: se levantó con docker-compose.yml en vez del de Fedora."
    info "docker compose down  y luego  ${COMPOSE[*]} up -d --build"
  fi
done

echo "== 2b. MariaDB"
if ss -ltn 2>/dev/null | grep -qE '[:.]3306\s'; then
  ok "MariaDB escucha en tu Fedora: $(ss -ltn 2>/dev/null | grep -E '[:.]3306\s' | awk '{print $4}' | tr '\n' ' ')"
else
  mal "Nada escucha en el puerto 3306 de tu Fedora."
  info "sudo systemctl enable --now mariadb   (y revisa que no haya skip-networking en /etc/my.cnf.d/)"
fi
if [ "$(docker inspect -f '{{.State.Running}}' calidad-agua-api 2>/dev/null)" = "true" ]; then
  PRUEBA=$(docker exec calidad-agua-api node -e '
    const s = require("net").connect({ host: process.env.DB_HOST || "127.0.0.1", port: +(process.env.DB_PORT || 3306) });
    s.setTimeout(3000);
    s.on("connect", () => { console.log("OK"); process.exit(0); });
    s.on("timeout", () => { console.log("ETIMEDOUT"); process.exit(1); });
    s.on("error", (e) => { console.log(e.code); process.exit(1); });' 2>&1 | tail -1)
  case "$PRUEBA" in
    OK) ok "Desde el contenedor de la API sí se llega al puerto de MariaDB."
        info "Si la API aún falla, es usuario/contraseña: bash scripts/fedora/preparar-mariadb.sh y ${COMPOSE[*]} up -d --force-recreate api" ;;
    ECONNREFUSED) mal "Desde el contenedor, 127.0.0.1:3306 rechaza la conexión: el contenedor no está en la red de tu Fedora (rootless, Desktop o Podman) o MariaDB no escucha por TCP." ;;
    EACCES) mal "SELinux bloquea al contenedor de la API (permiso denegado al conectar)."
            info "Revisa: sudo ausearch -m avc -ts recent | tail ; compártelo para ver el arreglo exacto." ;;
    ETIMEDOUT) mal "Desde el contenedor, la conexión a MariaDB se queda colgada: el contenedor no está en la red de tu Fedora (rootless, Desktop o Podman) o un firewall la bloquea." ;;
    *) mal "Prueba de conexión desde el contenedor: $PRUEBA" ;;
  esac
fi

echo "== 3. Puerto 8080"
ESCUCHA=$(ss -ltnp 2>/dev/null | grep -E '[:.]8080\s' || true)
if [ -z "$ESCUCHA" ]; then
  mal "Nadie escucha en el puerto 8080 de tu Fedora."
  info "Si el contenedor web dice 'corriendo', casi seguro Docker está en rootless/Desktop (ver sección 1). Log de nginx:"
  docker logs --tail 6 calidad-agua-web 2>&1 | sed 's/^/      /'
else
  ok "Algo escucha en 8080: $(echo "$ESCUCHA" | awk '{print $4}' | head -1)"
  if ! docker logs calidad-agua-web 2>&1 | grep -q "start worker"; then
    info "Si nginx dice 'address already in use', otro programa tiene el 8080:  sudo ss -ltnp | grep 8080"
  fi
fi

echo "== 4. Página y API"
CODIGO=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8080/ 2>/dev/null)
case "$CODIGO" in
  200) ok "La página responde en http://localhost:8080" ;;
  403) mal "La página da 403: SELinux no deja a nginx leer la carpeta docs/."
       info "sudo chcon -Rt container_file_t docs nginx.fedora.conf  y  ${COMPOSE[*]} restart web" ;;
  000) mal "No hay respuesta en http://127.0.0.1:8080/." ;;
  *)   mal "La página respondió $CODIGO." ;;
esac
SALUD=$(curl -s --max-time 5 http://127.0.0.1:8080/api/salud 2>/dev/null)
if [[ "$SALUD" == *'"ok":true'* ]]; then ok "API conectada a MariaDB"
elif [ -n "$SALUD" ]; then mal "API responde pero sin MariaDB: $SALUD"; info "docker logs calidad-agua-api"
else mal "La API no responde en /api/salud."; info "docker logs calidad-agua-api"
fi

echo "== 5. SELinux"
if command -v getenforce >/dev/null; then
  info "SELinux: $(getenforce)"
  if [ "$CODIGO" = "403" ] && command -v ausearch >/dev/null; then
    info "Bloqueos recientes: sudo ausearch -m avc -ts recent | tail"
  fi
fi

echo
if [ "$PROBLEMAS" -eq 0 ]; then
  echo "Todo responde. Abre en el navegador exactamente:  http://localhost:8080   (con http://, no https://)"
  echo "Si el navegador insiste en https, prueba:  http://127.0.0.1:8080"
else
  echo "$PROBLEMAS problema(s). Arregla el primero en rojo y vuelve a correr este script."
  echo "Si no queda claro, copia toda esta salida y compártela."
fi
