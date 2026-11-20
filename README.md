# Monitoreo de calidad del agua · Página web IoT (TC1004B)

Página web con semáforo de calidad del agua. Lee pH, turbidez y conductividad que el **ESP32** publica en **ThingSpeak**. Corre en **localhost con Docker** y se publica en **GitHub Pages**.

```
[Sensores] → [ESP32] ──WiFi/HTTPS cada 20 s──┬──► Ubidots     (lo que ya tienen, se queda igual)
                                              └──► ThingSpeak  (nuevo)
                                                       │  HTTPS (Read API Key)
                                                       ▼
                               Página web: localhost:8080 (Docker)  o  GitHub Pages
```

La página tiene 4 pantallas: **Inicio** (semáforo y 3 variables), **Historial** (gráficas), **Alertas** (cambios de color) y **Ajustes** (fuente de datos y umbrales). Incluye un **modo demo** con datos simulados para presentar sin el hardware.

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

**Opcional (apagado por defecto, en Ajustes):** rojo inmediato si una sola variable pasa su límite crítico (pH < 6.0 o > 9.0, turbidez > 50 NTU, conductividad > 3000 µS/cm). Todos los umbrales se editan en la pantalla Ajustes.

La lógica está en `docs/js/semaforo.js` y tiene pruebas: `node --test tests/*.test.js`.

---

## Paso 0 · Lo que necesitan instalado

1. **Docker Desktop** (Windows/Mac) o Docker Engine (Linux). Verifiquen con `docker --version`.
2. **Git** y una cuenta de **GitHub**.
3. Una cuenta gratuita de **ThingSpeak** (se entra con cuenta de MathWorks).

## Paso 1 · Correr la página en localhost con Docker

```bash
cd IoT-interface-design-
docker compose up -d --build
```

Abran **http://localhost:8080**. Arranca en modo demo, así que ya deben ver el semáforo funcionando.

- Editan cualquier archivo dentro de `docs/`, recargan el navegador y ya se ve el cambio (la carpeta está montada en vivo).
- Ver logs: `docker compose logs -f`
- Apagar: `docker compose down`

> Sin Docker (plan B): `cd docs && python -m http.server 8080`. No abran el `index.html` con doble clic: el navegador bloquea las peticiones a ThingSpeak desde `file://`.

## Paso 2 · Crear el canal en ThingSpeak

1. En thingspeak.mathworks.com: **Channels → My Channels → New Channel**.
2. Llenen los campos **en este orden** (la página depende de él):
   - Field 1: `pH`
   - Field 2: `Turbidez`
   - Field 3: `Conductividad`
   - Field 4: `Temperatura`
3. **Save Channel**. Anoten el **Channel ID** (número arriba del canal).
4. Pestaña **API Keys**: copien la **Write API Key** (para el ESP32) y la **Read API Key** (para la página).
5. Opcional: en **Sharing** elijan "Share channel view with everyone". Con el canal público la página no necesita Read API Key.

## Paso 3 · Que el ESP32 también mande a ThingSpeak (sin quitar Ubidots)

1. Abran `esp32/thingspeak_envio.ino` y copien a su firmware la función `enviarThingSpeak(...)` y sus `#include`.
2. Pongan su Write API Key en `TS_WRITE_KEY`. Mejor: muévanla a `esp32/secretos.h` (ya está en `.gitignore`) para no subirla a GitHub.
3. En su `loop()`, después de enviar a Ubidots, llamen a `enviarThingSpeak(ph, turbidez, conductividad, temperatura)` **cada 20 s** (el plan gratis rechaza envíos con menos de 15 s de diferencia).
4. Monitor serie: debe imprimir un `entry_id` mayor que 0. Si imprime `0`, están enviando demasiado rápido.
5. En ThingSpeak, pestaña **Private View**: deben aparecer puntos en las 4 gráficas.

Si un sensor falla, **no manden 0**: omitan ese field. La página lo toma como "sin dato" y pone gris en vez de clasificar un valor falso.

## Paso 4 · Conectar la página a ThingSpeak

1. En http://localhost:8080 → **Ajustes**.
2. Fuente: **ThingSpeak**. Escriban el **Channel ID** y la **Read API Key** (vacía si el canal es público).
3. **Probar conexión**: debe decir "Conexión correcta" y cuándo fue la última lectura.
4. **Guardar**. Vuelvan a Inicio: el semáforo ya muestra datos reales y se actualiza solo cada 20 s.

Los Ajustes se guardan en el navegador de cada quien. Para que la página publicada **ya arranque conectada** para cualquier persona, editen `docs/js/config.js`:

```js
fuente: "thingspeak",
thingspeak: { channelId: "SU_CHANNEL_ID", readApiKey: "SU_READ_KEY_O_VACIO" },
```

⚠️ **Nunca** pongan la Write API Key en `docs/`. Todo lo que está ahí es público en GitHub Pages.

## Paso 5 · Probar el semáforo con muestras reales

| Muestra | Resultado esperado |
|---|---|
| Agua de la llave o purificada | 🟢 Verde |
| Agua con un poco de tierra | 🟡 Amarillo (turbidez alta) |
| Agua con bastante sal | 🟡 Amarillo (conductividad alta) |
| Agua con tierra y vinagre | 🔴 Rojo (turbidez alta y pH ácido) |
| Sonda de conductividad fuera del agua | 🟡 Amarillo (conductividad < 50) |
| Desconectar el ESP32 por 3 min | ⚪ Gris |

En Alertas debe aparecer cada cambio de color. Si algo no cuadra, revisen primero la calibración en el firmware (buffers de pH 4/7/10 y solución de referencia para conductividad).

## Paso 6 · Publicar en GitHub Pages

El código ya vive en **https://github.com/Marcoflesh/IoT-interface-design-**. Para traerlo y subir cambios:

```bash
git clone https://github.com/Marcoflesh/IoT-interface-design-.git
cd IoT-interface-design-
# ...cambios...
git add .
git commit -m "Describe el cambio"
git push
```

En GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / carpeta `/docs` → Save**. En 1 o 2 minutos la página queda en:

**https://marcoflesh.github.io/IoT-interface-design-/**

Cada `git push` vuelve a publicarla. GitHub Pages usa la carpeta `docs/` y Docker usa esa misma carpeta, así que lo que ven en localhost es lo que se publica.

---

## Solución de problemas

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| `port is already allocated` | Otro programa usa el 8080 | Cambien `"8080:80"` por `"8081:80"` en `docker-compose.yml` |
| "Canal no encontrado o Read API Key incorrecta" | Channel ID o llave mal copiados | Cópienlos otra vez desde la pestaña API Keys |
| "El canal es privado" | Falta la Read API Key | Agréguenla o hagan público el canal |
| Semáforo gris con datos viejos | El ESP32 no envía hace más de 3 min | Revisen WiFi y el monitor serie |
| ESP32 imprime `entry_id: 0` | Envía cada menos de 15 s | Suban `TS_INTERVALO_MS` a 20000 |
| La página publicada no cambia | Caché del navegador | Recarguen con Ctrl+Shift+R |

## Estructura

```
IoT-interface-design-/
├── docs/                    ← la página (Docker y GitHub Pages usan esta carpeta)
│   ├── index.html
│   ├── css/styles.css       ← paleta azul (neutro a oscuro)
│   ├── js/config.js         ← Channel ID, campos, intervalo
│   ├── js/semaforo.js       ← reglas del semáforo
│   ├── js/datos.js          ← ThingSpeak + modo demo
│   ├── js/app.js            ← pantallas e interacciones
│   └── js/vendor/           ← Chart.js 4.6.1 (local, sin CDN)
├── esp32/thingspeak_envio.ino
├── tests/semaforo.test.js
├── proyecto/                ← handoff.md, traceability.md, roadmap.md
├── Dockerfile · docker-compose.yml · nginx.conf
└── README.md                ← esta guía
```
