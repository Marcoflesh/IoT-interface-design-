#!/usr/bin/env bash
# Prueba tu canal de ThingSpeak con los datos del .env y explica qué está mal si no puede leerlo.
#
#   bash scripts/fedora/probar-thingspeak.sh             → lee el canal (Channel ID + Read API Key)
#   bash scripts/fedora/probar-thingspeak.sh --escribir  → además escribe una lectura de prueba (Write Key)
#                                                         (no lo uses en el canal que vas a presentar)
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
# shellcheck source=scripts/fedora/lib-mariadb.sh
source scripts/fedora/lib-mariadb.sh

ok()   { printf '\033[32m✓ %s\033[0m\n' "$1"; }
mal()  { printf '\033[31m✕ %s\033[0m\n' "$1"; }
info() { printf '  %s\n' "$1"; }
API=${THINGSPEAK_API:-https://api.thingspeak.com}

[ -f .env ] || { mal "Falta .env en $(pwd) (cp .env.example .env)"; exit 1; }
ok "Leyendo $(pwd)/.env"

# Si una variable aparece varias veces, gana la ÚLTIMA. Avisa, porque es un error muy común
# (pegar la llave arriba y dejar abajo la línea vacía de la plantilla).
revisar_repetida() {
  local n lineas
  n=$(grep -cE "^[[:space:]]*$1[[:space:]]*=" .env || true)
  if [ "$n" -gt 1 ]; then
    lineas=$(grep -nE "^[[:space:]]*$1[[:space:]]*=" .env | cut -d: -f1 | paste -sd, -)
    mal "$1 aparece $n veces en el .env (líneas $lineas). Se usa la ÚLTIMA: deja solo una."
    return 1
  fi
  [ "$n" -eq 0 ] && { mal "No hay ninguna línea $1= en el .env (¿la escribiste con otro nombre?)."; return 1; }
  return 0
}

# Muestra una llave sin revelarla completa: primeras 4 letras, últimas 2 y su largo.
enmascarar() { local k=$1; [ ${#k} -le 6 ] && printf '%s' "${k//?/•}" || printf '%s…%s' "${k:0:4}" "${k: -2}"; }

# Revisa que una llave de ThingSpeak tenga 16 letras/números; si no, dice qué caracteres sobran.
revisar_llave() {
  local nombre=$1 valor=$2
  if [ -z "$valor" ]; then mal "$nombre está vacía."; return 1; fi
  if [[ "$valor" =~ ^[A-Za-z0-9]{16}$ ]]; then
    ok "$nombre leída: $(enmascarar "$valor") (16 caracteres)"
    return 0
  fi
  mal "$nombre leída: $(enmascarar "$valor") ($(python3 -c 'import sys; print(len(sys.argv[1]))' "$valor") caracteres; deben ser 16 letras/números)"
  printf '%s' "$valor" | python3 -c '
import sys
v = sys.stdin.read()
raros = [(i + 1, repr(c)) for i, c in enumerate(v) if not c.isascii() or not c.isalnum()]
if raros:
    print("  Caracteres que sobran (posición, carácter): " + ", ".join("%d %s" % r for r in raros))
    print("  Suelen venir de copiar con espacios o comillas especiales. Escríbela de nuevo a mano en el .env.")
'
  return 1
}

FALLAS=0
revisar_repetida THINGSPEAK_CHANNEL_ID || FALLAS=$((FALLAS + 1))
revisar_repetida THINGSPEAK_READ_KEY   || FALLAS=$((FALLAS + 1))

CANAL=$(leer_env THINGSPEAK_CHANNEL_ID)
LEER=$(leer_env THINGSPEAK_READ_KEY)
ESCRIBIR=$(leer_env THINGSPEAK_WRITE_KEY)

if [[ "$CANAL" =~ ^[0-9]+$ ]]; then ok "Channel ID: $CANAL"
else mal "THINGSPEAK_CHANNEL_ID debe ser el número del canal (está: '${CANAL}')."; FALLAS=$((FALLAS + 1)); fi
revisar_llave THINGSPEAK_READ_KEY "$LEER" || FALLAS=$((FALLAS + 1))
if [ -n "$LEER" ] && [ "$LEER" = "$ESCRIBIR" ]; then
  mal "THINGSPEAK_READ_KEY es igual a THINGSPEAK_WRITE_KEY: pegaste la Write Key. La Read está en API Keys → Read API Keys."
  FALLAS=$((FALLAS + 1))
fi
[ "$FALLAS" -eq 0 ] || { echo; echo "Corrige lo de arriba en el .env y vuelve a correr este script."; exit 1; }

# 1) Escritura de prueba (opcional)
if [ "${1:-}" = "--escribir" ]; then
  revisar_llave THINGSPEAK_WRITE_KEY "$ESCRIBIR" || exit 1
  R=$(curl -s --max-time 15 "$API/update?api_key=$ESCRIBIR&field1=7.21&field2=1.3&field3=640&field4=22.5")
  case "$R" in
    ''|*[!0-9]*) mal "ThingSpeak no aceptó la escritura (respuesta: '${R}'). ¿Write Key correcta?"; exit 1 ;;
    0) mal "ThingSpeak respondió 0: pasaron menos de 15 s desde la última escritura. Espera y repite." ; exit 1 ;;
    *) ok "Escritura de prueba guardada: entry_id $R" ; sleep 2 ;;
  esac
fi

# 2) Lectura con la Read Key
leer_canal() {   # $1 = llave (puede ir vacía) → deja CODIGO y CUERPO
  local url="$API/channels/$CANAL/feeds.json?results=3" r
  [ -n "$1" ] && url="$url&api_key=$1"
  r=$(curl -s --max-time 15 -w '\n%{http_code}' "$url")
  CODIGO=${r##*$'\n'}
  CUERPO=${r%$'\n'*}
}

leer_canal "$LEER"
if [ "$CODIGO" = "000" ]; then mal "Sin conexión con api.thingspeak.com (¿internet?)."; exit 1; fi
if [ "$CODIGO" = "404" ]; then mal "ThingSpeak no encuentra el canal $CANAL: revisa THINGSPEAK_CHANNEL_ID."; exit 1; fi
if [ "$CUERPO" = "-1" ] || [ "$CODIGO" != "200" ]; then
  mal "ThingSpeak rechazó la Read Key $(enmascarar "$LEER") para el canal $CANAL (HTTP $CODIGO)."
  info "La llave tiene buen formato, así que es de otra cosa. Revisa, en ese orden:"
  info "1. Que THINGSPEAK_CHANNEL_ID sea el del canal NUEVO (no el viejo): está arriba en la página del canal."
  info "2. Que copiaste la de API Keys → Read API Keys de ESE canal, no la Write Key ni la de tu perfil (User API Key)."
  info "3. Que no la regeneraste después de copiarla (Generate New Read API Key invalida la anterior)."
  exit 1
fi

printf '%s' "$CUERPO" | python3 -c '
import json, sys
d = json.load(sys.stdin)
c = d.get("channel", {})
print("\033[32m✓ Canal \"%s\" leído con tu Read Key · campos: %s\033[0m" % (c.get("name", "?"),
      ", ".join("%s=%s" % (k, c[k]) for k in ("field1", "field2", "field3", "field4") if c.get(k))))
esperado = ["ph", "turbidez", "conductividad", "temperatura"]
nombres = [(c.get("field%d" % i) or "").lower() for i in range(1, 5)]
if not all(e[:4] in n for e, n in zip(esperado, nombres)):
    print("\033[33m! Revisa el orden: Field 1 pH, Field 2 Turbidez, Field 3 Conductividad, Field 4 Temperatura.\033[0m")
f = d.get("feeds", [])
print("  Última entrada: %s" % ("ninguna todavía (canal limpio)" if not f else
      "entry_id %s · %s · pH %s · %s NTU · %s µS/cm · %s °C" % (f[-1]["entry_id"], f[-1]["created_at"],
      f[-1].get("field1"), f[-1].get("field2"), f[-1].get("field3"), f[-1].get("field4"))))
'

# ¿De verdad es privado? Sin llave debería rechazar.
leer_canal ""
if [ "$CUERPO" != "-1" ] && [ "$CODIGO" = "200" ]; then
  printf '\033[33m! El canal se puede leer sin llave: es público. Si lo quieres privado: Sharing → Keep channel view private.\033[0m\n'
fi

echo
echo "Listo. El puente y la página leen el canal con estos mismos datos."
echo "Si los acabas de cambiar: docker compose -f docker-compose.fedora.yml --profile thingspeak up -d --force-recreate"
