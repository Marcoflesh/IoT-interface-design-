# Monitoreo de calidad del agua · Página web IoT (TC1004B)

Semáforo de calidad del agua con pH, turbidez y conductividad medidos por un **ESP32**. Las lecturas se guardan en dos lugares: **ThingSpeak** (para la página publicada en **GitHub Pages**) y una base de datos propia **MariaDB** (historial completo en la laptop, con Docker).

```
                         ┌──HTTPS cada 20 s──► ThingSpeak ──HTTPS──► Página en GitHub Pages
[Sensores] → [ESP32] ────┤                                  └─────► Página en localhost:8080
                         └──HTTP (red local)──► API (Node) ──► MariaDB
                                                    └──────────────► Página en localhost:8080
```

Todo lo local corre con un solo `docker compose up`:

| Servicio | Qué es | Dirección |
|---|---|---|
| `web` | nginx: la página y el acceso a la API (`/api`) | http://localhost:8080 |
| `api` | Node + Express: recibe lecturas del ESP32 y las guarda | (interno, vía `/api`) |
| `db` | MariaDB 11.4 con la tabla `lecturas` | localhost:3306 |
| `adminer` | Ver y consultar la base desde el navegador | http://localhost:8081 |

> 🐧 **¿Usas Fedora y ya tienes MariaDB instalada (terminal o DBeaver)?** Sigue **[FEDORA.md](FEDORA.md)**: usa tu MariaDB local y trae scripts que preparan todo en un comando.

> 🔁 **¿El ESP32 solo puede mandar a ThingSpeak?** El puente (`api/src/puente-thingspeak.js`, perfil `thingspeak`) copia cada minuto las lecturas nuevas del canal a MariaDB sin duplicar. Ver [FEDORA.md, Paso 11](FEDORA.md).

> 🧪 **¿Sin hardware todavía?** Hay un ESP32 virtual con física realista: un simulador de terminal (`simulador/simular-esp32.js`, también como perfil `simulador` de Docker) y una **página oculta** dentro del sitio. Para encontrarla: ↑ ↑ ↓ ↓ ← → ← → B A, o 5 toques en la gota del logo. Detalles en [FEDORA.md, Paso 10](FEDORA.md#paso-10--mientras-llega-el-hardware-esp32-virtual).

La página tiene 4 pantallas: **Inicio** (semáforo y 3 variables), **Historial** (gráficas), **Alertas** (cambios de color) y **Ajustes** (fuente de datos y umbrales). Puede leer de **ThingSpeak**, de **MariaDB** (solo en localhost) o de un **modo demo** para presentar sin hardware.

---

## Semáforo

| Variable | Dentro de rango | Fuente del límite |
|---|---|---|
| pH | 6.5 a 8.5 | NOM-127-SSA1-2021 |
| Turbidez | ≤ 4 NTU | NOM-127-SSA1-2021 (4 UNT) |
| Conductividad | 50 a 1500 µS/cm | Derivado del límite de SDT de la NOM (1000 mg/L, factor ≈ 0.65). Abajo de 50 suele ser la sonda fuera del agua. |

| Color | Regla |
|---|---|
| 🟢 Verde | Las 3 variables dentro de rango |
| 🟡 Amarillo | 1 variable fuera de rango |
| 🔴 Rojo | 2 o 3 variables fuera de rango |
| ⚪ Gris | Falta una lectura, o la última tiene más de 3 min (el ESP32 dejó de enviar) |

**Opcional (apagado por defecto, en Ajustes):** rojo inmediato si una sola variable pasa su límite crítico (pH < 6.0 o > 9.0, turbidez > 50 NTU, conductividad > 3000 µS/cm).

---

## Paso 0 · Lo que necesitan instalado

1. **Docker Desktop** (Windows/Mac) o Docker Engine (Linux). Verifiquen con `docker --version`.
2. **Git** y una cuenta de **GitHub**.
3. Una cuenta gratuita de **ThingSpeak** (se entra con cuenta de MathWorks).
4. Arduino IDE con la placa ESP32 (ya lo tienen).

## Paso 1 · Configurar contraseñas (`.env`)

```bash
git clone https://github.com/Marcoflesh/IoT-interface-design-.git
cd IoT-interface-design-
cp .env.example .env          # en Windows (PowerShell): copy .env.example .env
```

Abran `.env` y cambien las dos contraseñas y la `ESP32_API_KEY`. Para generar una llave:

```bash
python -c "import secrets; print(secrets.token_hex(16))"
```

`.env` está en `.gitignore`: **nunca se sube a GitHub**.

## Paso 2 · Levantar todo con Docker

```bash
docker compose up -d --build
docker compose ps             # los 4 servicios deben decir "running" (db: "healthy")
```

Revisen:

- http://localhost:8080 → la página (arranca en modo demo).
- http://localhost:8080/api/salud → debe responder `{"ok":true,"base":"MariaDB","lecturas":0,...}`.
- http://localhost:8081 → Adminer. Sistema: **MariaDB/MySQL**, servidor: `db`, usuario y contraseña de su `.env`, base: `calidad_agua`.

Comandos útiles:

| Para | Comando |
|---|---|
| Ver logs de la API | `docker compose logs -f api` |
| Apagar (los datos se conservan) | `docker compose down` |
| Borrar también la base de datos | `docker compose down -v` |

Los cambios dentro de `docs/` se ven con solo recargar el navegador. Si cambian algo en `api/`, corran `docker compose up -d --build api`.

## Paso 3 · Crear el canal en ThingSpeak

1. En thingspeak.mathworks.com: **Channels → My Channels → New Channel**.
2. Llenen los campos **en este orden** (la página depende de él): Field 1 `pH`, Field 2 `Turbidez`, Field 3 `Conductividad`, Field 4 `Temperatura`.
3. **Save Channel** y anoten el **Channel ID**.
4. Pestaña **API Keys**: copien la **Write API Key** (para el ESP32) y la **Read API Key** (para la página).
5. Opcional: en **Sharing** elijan "Share channel view with everyone" y la página no necesitará Read API Key.

## Paso 4 · Firmware: ESP32 → ThingSpeak + MariaDB (en lugar de Ubidots)

1. Saquen la **IP de la laptop** que corre Docker (misma red WiFi que el ESP32):
   Windows `ipconfig` (Adaptador Wi-Fi → IPv4) · Mac `ipconfig getifaddr en0` · Linux `hostname -I`.
2. Copien `esp32/secretos.example.h` como `esp32/secretos.h` junto a su sketch y llenen: WiFi, `TS_WRITE_KEY`, `API_URL` (ej. `http://192.168.1.50:8080/api/lecturas`) y `API_KEY` (la misma `ESP32_API_KEY` del `.env`).
3. Copien a su firmware las funciones de `esp32/envio_datos.ino` (`enviarThingSpeak` y `enviarAPI`) y **quiten el envío a Ubidots**.
4. En el `loop()`, cada 20 s, llamen a las dos funciones (el ejemplo está al final del archivo).
5. Monitor serie: debe salir `ThingSpeak entry_id: 123 · API HTTP: 201`.

Qué significa cada respuesta de la API:

| Código | Significado |
|---|---|
| 201 | Guardado en MariaDB |
| 400 | Dato inválido (texto, `nan` o valor físicamente imposible); el mensaje dice cuál |
| 401 | `API_KEY` distinta a la del `.env` |
| -1 / timeout | El ESP32 no llega a la laptop: revisen IP, misma red y firewall (Paso 9) |

Si un sensor falla, asígnenle `NAN`: ThingSpeak omite ese field y la API guarda `null`. **Nunca manden 0 como "sin dato"**.

## Paso 5 · Verificar que llegan los datos

- **ThingSpeak:** pestaña Private View del canal, deben aparecer puntos.
- **MariaDB:** http://localhost:8080/api/salud debe mostrar `lecturas` subiendo, o en Adminer abran la tabla `lecturas`.

## Paso 6 · Elegir de dónde lee la página

En la página → **Ajustes** → Fuente de datos → **Probar conexión** → **Guardar**.

| Fuente | Dónde funciona | Para qué |
|---|---|---|
| ThingSpeak | localhost y GitHub Pages | La versión pública |
| MariaDB | Solo http://localhost:8080 (Docker) | Demo en clase con su propia base |
| Demo | Siempre | Presentar sin hardware |

Los Ajustes se guardan en cada navegador. Para que la versión publicada **ya arranque con ThingSpeak**, editen `docs/js/config.js`:

```js
fuente: "thingspeak",
thingspeak: { channelId: "SU_CHANNEL_ID", readApiKey: "SU_READ_KEY_O_VACIO" },
```

⚠️ Nunca pongan la Write API Key ni la `ESP32_API_KEY` en `docs/`: todo lo que está ahí es público.

## Paso 7 · Probar el semáforo con muestras reales

| Muestra | Resultado esperado |
|---|---|
| Agua de la llave o purificada | 🟢 Verde |
| Agua con un poco de tierra | 🟡 Amarillo (turbidez alta) |
| Agua con bastante sal | 🟡 Amarillo (conductividad alta) |
| Agua con tierra y vinagre | 🔴 Rojo (turbidez alta y pH ácido) |
| Sonda de conductividad fuera del agua | 🟡 Amarillo (conductividad < 50) |
| Desconectar el ESP32 por 3 min | ⚪ Gris |

## Paso 8 · Publicar en GitHub Pages

En GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / carpeta `/docs` → Save**. En 1 o 2 minutos queda en **https://marcoflesh.github.io/IoT-interface-design-/**. Cada `git push` la vuelve a publicar.

La versión de GitHub Pages lee de **ThingSpeak**. MariaDB vive en la laptop, así que solo se ve desde localhost.

## Paso 9 · Consultas SQL útiles (Adminer → "Comando SQL")

```sql
-- Últimas 20 lecturas
SELECT * FROM lecturas ORDER BY id DESC LIMIT 20;

-- Promedios, mínimos y máximos por dispositivo y día (vista ya creada)
SELECT * FROM resumen_diario WHERE dispositivo = 'esp32-1';

-- ¿Quién está mandando datos y hace cuánto?
SELECT * FROM estado_dispositivos;

-- Lecturas fuera de rango del ESP32 real (mismos umbrales del semáforo)
SELECT fecha, ph, turbidez, conductividad FROM lecturas
WHERE dispositivo = 'esp32-1'
  AND (ph NOT BETWEEN 6.5 AND 8.5 OR turbidez > 4 OR conductividad NOT BETWEEN 50 AND 1500);

-- Exportar a Excel: en Adminer, botón "Exportar" → formato CSV.
```

Las fechas se guardan en **UTC** (Querétaro = UTC−6). La página las convierte a hora local sola.

---

## Solución de problemas

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| `Falta DB_PASSWORD en .env` | No existe el `.env` | Paso 1 |
| `port is already allocated` | Otro programa usa 8080, 8081 o 3306 | Cambien el primer número del puerto en `docker-compose.yml` |
| `/api/salud` responde `ok:false` | La base todavía está arrancando | Esperen 20 s; `docker compose logs db` |
| ESP32: `API HTTP: -1` | No alcanza la laptop | Misma red WiFi, IP correcta, y en Windows permitan el puerto 8080 en el Firewall (Windows Defender → Reglas de entrada → Puerto TCP 8080). Las redes de la universidad a veces bloquean conexiones entre dispositivos: usen el hotspot de un celular. |
| ESP32: `API HTTP: 401` | Llaves distintas | `API_KEY` en `secretos.h` = `ESP32_API_KEY` en `.env`, luego `docker compose up -d api` |
| ESP32: `entry_id: 0` | ThingSpeak: envío antes de 15 s | `INTERVALO_ENVIO_MS = 20000` |
| La IP de la laptop cambió | DHCP del router | Actualicen `API_URL` o reserven la IP en el router |
| Cambié la contraseña de la base y ya no conecta | MariaDB solo lee el `.env` la primera vez | `docker compose down -v` (borra los datos) y `docker compose up -d` |
| "El canal es privado" | Falta Read API Key | Agréguenla o hagan público el canal |

## Pruebas

```bash
node --test tests/*.test.js            # semáforo y ESP32 virtual
cd api && npm install && npm test      # validación de la API
```

## Estructura

```
IoT-interface-design-/
├── docs/                    ← la página (Docker y GitHub Pages usan esta carpeta)
│   ├── index.html
│   ├── css/styles.css       ← paleta azul (neutro a oscuro)
│   ├── js/config.js         ← fuente por defecto, Channel ID, campos
│   ├── js/semaforo.js       ← reglas del semáforo
│   ├── js/datos.js          ← ThingSpeak, API (MariaDB) y modo demo
│   ├── js/app.js            ← pantallas e interacciones
│   ├── js/esp32-virtual.js  ← modelo físico del ESP32 y sus sensores
│   ├── js/laboratorio.js    ← página oculta (easter egg)
│   └── js/vendor/           ← Chart.js 4.6.1 (local)
├── api/                     ← API Node + Express para MariaDB
│   ├── migraciones/         ← 001 lecturas · 002 dispositivos y diagnóstico · 003 ThingSpeak
│   ├── src/app.js · server.js · validar.js · migrar.js
│   ├── src/puente-thingspeak.js ← copia ThingSpeak → MariaDB
│   └── test/
├── simulador/simular-esp32.js ← ESP32 virtual en la terminal
├── esp32/
│   ├── envio_datos.ino      ← envío a ThingSpeak y a la API
│   └── secretos.example.h
├── tests/semaforo.test.js
├── proyecto/                ← handoff.md, traceability.md, roadmap.md
├── scripts/fedora/          ← preparar MariaDB local y probar la conexión
├── docker-compose.yml · Dockerfile · nginx.conf · .env.example
├── docker-compose.fedora.yml · nginx.fedora.conf   ← variante Fedora con MariaDB local
├── FEDORA.md                ← guía para Fedora + DBeaver
└── README.md                ← esta guía
```
