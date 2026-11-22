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
if [[ "$SO" == *"Docker Desktop"* ]]; then
  mal "Estás usando Docker Desktop ($SO)."
  info "Docker Desktop corre en una máquina virtual: con network_mode host la página no queda en el localhost de Fedora"
  info "ni la API llega a tu MariaDB. Usa Docker Engine:  docker context use default  (o instálalo con el Paso 1)."
else
  ok "Docker Engine funcionando ($(docker version --format '{{.Server.Version}}' 2>/dev/null))"
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

echo "== 3. Puerto 8080"
ESCUCHA=$(ss -ltnp 2>/dev/null | grep -E '[:.]8080\s' || true)
if [ -z "$ESCUCHA" ]; then
  mal "Nadie escucha en el puerto 8080 (nginx no arrancó)."
  info "Revisa:  docker logs calidad-agua-web"
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
