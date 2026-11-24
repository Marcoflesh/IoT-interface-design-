#!/usr/bin/env bash
# Pone tu canal de ThingSpeak en la página publicada (docs/js/config.js) usando los datos del .env,
# para que GitHub Pages lea las lecturas del ESP32.
#
#   bash scripts/configurar-pagina.sh     → escribe Channel ID y Read API Key (el canal es privado)
#
# Solo pone datos de LECTURA. La Write API Key nunca va en docs/ (es público).
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
# shellcheck source=scripts/fedora/lib-mariadb.sh
source scripts/fedora/lib-mariadb.sh

ARCHIVO=docs/js/config.js
[ -f .env ] || { echo "Falta .env"; exit 1; }
CANAL=$(leer_env THINGSPEAK_CHANNEL_ID)
LEER=$(leer_env THINGSPEAK_READ_KEY)
FUENTE="thingspeak"
[[ "$CANAL" =~ ^[0-9]+$ ]] || { echo "THINGSPEAK_CHANNEL_ID en .env debe ser un número."; exit 1; }
[ -n "$LEER" ] || { echo "Falta THINGSPEAK_READ_KEY en .env: el canal es privado y la página no podría leerlo."; exit 1; }
[[ "$LEER" =~ ^[A-Za-z0-9]{16}$ ]] || { echo "THINGSPEAK_READ_KEY debe tener 16 letras/números (pestaña API Keys → Read API Keys)."; exit 1; }

python3 - "$ARCHIVO" "$FUENTE" "$CANAL" "$LEER" <<'PY'
import re, sys
archivo, fuente, canal, leer = sys.argv[1:5]
s = open(archivo, encoding="utf-8").read()
s, n1 = re.subn(r'(\n  fuente: )"[a-z]+"', r'\1"%s"' % fuente, s, count=1)
s, n2 = re.subn(r'(channelId: )"[^"]*"', r'\1"%s"' % canal, s, count=1)
s, n3 = re.subn(r'(readApiKey: )"[^"]*"', r'\1"%s"' % leer, s, count=1)
if (n1, n2, n3) != (1, 1, 1):
    sys.exit("No reconocí el formato de %s; edítalo a mano." % archivo)
open(archivo, "w", encoding="utf-8").write(s)
PY

echo "✓ $ARCHIVO: fuente \"$FUENTE\"${CANAL:+, canal $CANAL}${LEER:+, con Read API Key}"
git --no-pager diff --stat -- "$ARCHIVO" 2>/dev/null || true
cat <<FIN

Para publicarlo en GitHub Pages:
  git add $ARCHIVO
  git commit -m "Página: leer el canal de ThingSpeak"
  git push
En 1 o 2 minutos: https://marcoflesh.github.io/IoT-interface-design-/
FIN
