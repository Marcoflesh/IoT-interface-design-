#!/usr/bin/env bash
# Prueba tu canal de ThingSpeak con los datos del .env.
#
#   bash scripts/fedora/probar-thingspeak.sh             → lee el canal (Channel ID y, si hace falta, Read Key)
#   bash scripts/fedora/probar-thingspeak.sh --escribir  → además escribe una lectura de prueba (Write Key)
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
# shellcheck source=scripts/fedora/lib-mariadb.sh
source scripts/fedora/lib-mariadb.sh

ok()  { printf '\033[32m✓ %s\033[0m\n' "$1"; }
mal() { printf '\033[31m✕ %s\033[0m\n' "$1"; }
API=https://api.thingspeak.com

[ -f .env ] || { mal "Falta .env (cp .env.example .env)"; exit 1; }
CANAL=$(leer_env THINGSPEAK_CHANNEL_ID)
LEER=$(leer_env THINGSPEAK_READ_KEY)
ESCRIBIR=$(leer_env THINGSPEAK_WRITE_KEY)

[[ "$CANAL" =~ ^[0-9]+$ ]] || { mal "THINGSPEAK_CHANNEL_ID debe ser el número del canal (está: '${CANAL}')."; exit 1; }
ok "Channel ID: $CANAL"

# 1) Escritura de prueba (opcional)
if [ "${1:-}" = "--escribir" ]; then
  [ ${#ESCRIBIR} -eq 16 ] || { mal "THINGSPEAK_WRITE_KEY debe tener 16 caracteres (pestaña API Keys)."; exit 1; }
  R=$(curl -s --max-time 15 "$API/update?api_key=$ESCRIBIR&field1=7.21&field2=1.3&field3=640&field4=22.5")
  case "$R" in
    ''|*[!0-9]*) mal "ThingSpeak no aceptó la escritura (respuesta: '${R}'). ¿Write Key correcta?"; exit 1 ;;
    0) mal "ThingSpeak respondió 0: pasaron menos de 15 s desde la última escritura. Espera y repite." ; exit 1 ;;
    *) ok "Escritura de prueba guardada: entry_id $R" ; sleep 2 ;;
  esac
fi

# 2) Lectura
URL="$API/channels/$CANAL/feeds.json?results=3"
[ -n "$LEER" ] && URL="$URL&api_key=$LEER"
R=$(curl -s --max-time 15 -w '\n%{http_code}' "$URL")
CODIGO=${R##*$'\n'}
CUERPO=${R%$'\n'*}
if [ "$CODIGO" = "000" ]; then mal "Sin conexión con api.thingspeak.com (¿internet?)."; exit 1; fi
if [ "$CUERPO" = "-1" ]; then
  mal "El canal es privado y falta THINGSPEAK_READ_KEY (o es incorrecta)."
  echo "  → Ponla en el .env, o hazlo público: Sharing → Share channel view with everyone."
  exit 1
fi
if [ "$CODIGO" != "200" ]; then mal "ThingSpeak respondió HTTP $CODIGO: ¿el Channel ID existe?"; exit 1; fi

printf '%s' "$CUERPO" | python3 -c '
import json, sys
d = json.load(sys.stdin)
c = d.get("channel", {})
print("\033[32m✓ Canal \"%s\" · campos: %s\033[0m" % (c.get("name", "?"),
      ", ".join("%s=%s" % (k, c[k]) for k in ("field1", "field2", "field3", "field4") if c.get(k))))
esperado = ["ph", "turbidez", "conductividad", "temperatura"]
nombres = [(c.get("field%d" % i) or "").lower() for i in range(1, 5)]
if not all(e[:4] in n for e, n in zip(esperado, nombres)):
    print("\033[33m! Revisa el orden: Field 1 pH, Field 2 Turbidez, Field 3 Conductividad, Field 4 Temperatura.\033[0m")
f = d.get("feeds", [])
print("  Última entrada: %s" % ("ninguna todavía" if not f else
      "entry_id %s · %s · pH %s · %s NTU · %s µS/cm · %s °C" % (f[-1]["entry_id"], f[-1]["created_at"],
      f[-1].get("field1"), f[-1].get("field2"), f[-1].get("field3"), f[-1].get("field4"))))
'
echo
echo "Listo. Si esto funciona, el puente y la página pueden leer el canal."
