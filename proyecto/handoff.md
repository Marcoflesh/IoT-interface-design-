# Handoff · Web IoT · Monitoreo de calidad del agua (TC1004B)

**Fecha:** 2026-11-24 · **Último prompt:** quitar el ESP32 virtual y dejar solo el real

## Repositorio
- https://github.com/Marcoflesh/IoT-interface-design- · rama `main`.
- GitHub Pages **activo** desde `main` / raíz. Como la raíz mostraba el README, se agregó `index.html` (redirige a `docs/`) y `.nojekyll`. La app quedó en https://marcoflesh.github.io/IoT-interface-design-/docs/ (verificada) y la raíz redirige ahí.
- Opcional para URL sin `/docs/`: Settings → Pages → Branch `main`, carpeta `/docs`.

## Arquitectura actual
```
ESP32 real (esp32-1) ─┬─HTTPS─► ThingSpeak ─► página (GitHub Pages y localhost)
ESP32 virtual ────────┤
 (esp32-sim)          └─HTTP LAN─► nginx /api ─► API Node ─► MariaDB ─► página (localhost) · DBeaver · terminal
Laboratorio oculto (navegador) ─► fuente "simulador" de la página (y opcionalmente /api)
```

## Base de datos v2 (cómo quedó y por qué)
| Decisión | Motivo |
|---|---|
| Migraciones numeradas `api/migraciones/NNN_*.sql` + tabla `schema_migraciones` | Cambiar la base sin perder datos ni recrearla; cada cambio queda registrado |
| Fedora: migraciones las aplica root (`preparar-mariadb.sh`); la API solo SELECT, INSERT, UPDATE | Si se filtra la contraseña de la API no se pueden borrar datos ni tablas |
| Docker: la API aplica migraciones pendientes al arrancar | En Docker el usuario de la app es dueño de su base |
| Tabla `dispositivos` + FK desde `lecturas` | Separar ESP32 real (`esp32-1`) del simulado (`esp32-sim`); saber cuándo se conectó cada uno |
| Columnas `rssi`, `ph_v`, `turbidez_v`, `conductividad_v` | Depurar WiFi y calibraciones sin tocar el firmware |
| Tabla `calibraciones` | Historial de calibraciones por sensor |
| Vistas `resumen_diario` (por dispositivo) y `estado_dispositivos` | Reporte y "¿quién dejó de mandar datos?" |
| `respaldar.sh` con rotación de 14 | Respaldo antes de demos y de borrar datos |

## Acceso de administrador a MariaDB (error 1045)
- Causa: el root de MariaDB de Marco tiene contraseña (entra con `-p` y DBeaver); el script asumía `sudo mariadb` por socket y pedía la contraseña varias veces.
- `scripts/fedora/lib-mariadb.sh` (usado por `preparar-mariadb.sh` y `respaldar.sh`): usa `DB_ROOT_PASSWORD` del `.env`, si no `sudo mariadb`, si no la pide **una vez**; la pasa por `MYSQL_PWD` (no en la línea de comandos) y explica en español los errores 1045, 1698 y 2002.
- FEDORA.md: las tres contraseñas (Linux, root de MariaDB, usuario `agua`), `USE calidad_agua;` antes de `SHOW TABLES`, y recuperación de la contraseña de root (probada: no borra datos y deja root con socket + contraseña).
- Probado como usuario normal sin sudo con root solo por contraseña: contraseña mala → mensaje 1045 claro; correcta (escrita o en `.env`) → base creada; respaldo OK.

## Windows (WINDOWS.md)
- Decisión: en Windows MariaDB corre **dentro de Docker** (`docker-compose.yml`), porque Docker en Windows es Docker Desktop (VM/WSL2) y la variante Fedora depende de red host.
- `docker-compose.yml`: puertos configurables `DB_PUERTO_LOCAL` (3307 si ya hay MariaDB/MySQL en Windows) y `WEB_PUERTO` (si Hyper-V reserva el 8080). `.gitattributes` fija LF en sh/sql/conf/js/yml/md y CRLF en ps1.
- `scripts/windows/` (UTF-8 con BOM para Windows PowerShell 5.1): `lib.ps1` (lector de .env con reglas de Compose, `docker exec` a MariaDB por stdin), `probar-conexion.ps1`, `abrir-firewall.ps1` (red Privada + regla de entrada), `ver-mariadb.ps1 [-Seguir]`, `probar-thingspeak.ps1 [-Escribir]`, `configurar-pagina.ps1 [-Demo]`, `respaldar.ps1 [-Restaurar]` (volcado comprimido dentro del contenedor y `docker cp`, para no pasar por la redirección de PowerShell 5.1).
- Verificado: todo el SQL de los scripts contra MariaDB real con el usuario de la app; regex de `configurar-pagina`; `docker compose config` con puertos cambiados y perfiles. **No verificado:** ejecución de los .ps1 (no se pudo instalar PowerShell en el entorno) ni Docker Desktop en Windows.

## Ver datos desde la terminal
- `scripts/fedora/ver-mariadb.sh [--seguir]`: con el usuario de la app muestra `estado_dispositivos`, últimas 10 lecturas en hora de México (CONVERT_TZ a -06:00) con el color del semáforo calculado en SQL, y el resumen de la última hora por dispositivo y origen. Probado contra MariaDB real.

## ThingSpeak de cero (guía FEDORA.md 11.1 a 11.6)
- `.env.example` reordenado en 5 secciones, sin comentarios en línea; incluye `THINGSPEAK_WRITE_KEY` y `PUENTE_DISPOSITIVO`.
- `scripts/fedora/probar-thingspeak.sh [--escribir]`: valida Channel ID, escribe una lectura de prueba (Write Key), lee el canal, avisa si es privado sin Read Key y revisa el orden de los 4 campos.
- `scripts/configurar-pagina.sh [--demo]`: pone `fuente: "thingspeak"`, Channel ID y Read Key (si es privado) en `docs/js/config.js`; nunca la Write Key. Probado ida y vuelta (queda idéntico con `--demo`).
- Recomendación: dos canales (pruebas para el simulador con `PUENTE_DISPOSITIVO=esp32-sim-ts`, y real con `esp32-1-ts`) para no mezclar datos.
- No verificado aquí: llamadas reales a api.thingspeak.com (sin salida desde el entorno).

## Puente ThingSpeak → MariaDB
- Dos caminos: (A) el ESP32 manda a ThingSpeak y a la API; (B) el ESP32 solo manda a ThingSpeak y `api/src/puente-thingspeak.js` copia cada `PUENTE_INTERVALO` s (60) las lecturas nuevas a MariaDB. B evita depender de que el ESP32 vea la laptop (red del Tec).
- Migración 003: `lecturas.origen` ('api' | 'thingspeak'), `ts_canal`, `ts_entry_id` + índice único (sin duplicados). Fecha = `created_at` de ThingSpeak (UTC). Dispositivo por defecto `esp32-1-ts`.
- Primera vez o hueco: pide hasta 8000 entradas; luego solo las últimas 100. Valida rangos físicos con `validar.js`. Funciona con el usuario de permisos mínimos.
- Perfil `thingspeak` en los dos compose; variables `THINGSPEAK_CHANNEL_ID`, `THINGSPEAK_READ_KEY`, `PUENTE_DISPOSITIVO`, `PUENTE_INTERVALO`.
- Verificado: 13/13 pruebas de API (historial 150 con una inválida, sin duplicados, 3 nuevas sin pedir historial, recuperación de 300 tras hueco, hora original, usuario mínimo) y corrida real del servicio con `preparar-mariadb.sh` (aplicó 003) contra un ThingSpeak falso: 40 copiadas. No probado contra ThingSpeak real (el entorno no tiene salida a api.thingspeak.com).
- Orden para Marco: `git pull` → `preparar-mariadb.sh` (003 como root) → `up -d --build` → `--profile thingspeak up -d`.

## Diagnóstico de localhost:8080
- `scripts/fedora/diagnosticar.sh` (solo lee): Docker instalado/servicio/grupo, Podman o Docker Desktop (con red host no llega al Fedora), estado y logs de `calidad-agua-web` y `calidad-agua-api`, quién escucha en 8080, código HTTP de la página (403 → SELinux), `/api/salud` y SELinux. Probado en escenario sano y con fallas simuladas.
- `lib-mariadb.sh`: sin terminal ya no se queda esperando la contraseña; explica el error y sale.
- Salida de Marco: `web` corriendo pero nada escucha en 8080; la API repite `ER_GET_CONNECTION_TIMEOUT` hacia 127.0.0.1:3306; SELinux Enforcing. Hipótesis principal: Docker rootless (o Desktop/Podman), donde la red host queda dentro de RootlessKit. Se descartó recomendar un booleano de SELinux (RHEL 8 quitó `container_can_connect_any`).
- `diagnosticar.sh` ahora detecta rootless y contexto, red de cada contenedor (compose equivocado), si MariaDB escucha en 3306 y prueba TCP desde dentro de la API (OK / ECONNREFUSED / EACCES / ETIMEDOUT) con el arreglo de cada caso.
- Resultado de Marco (21 nov 21:34): **Docker Desktop**. MariaDB escucha en 0.0.0.0:3306 y [::]:3306; desde el contenedor 127.0.0.1:3306 da ECONNREFUSED (la VM de Desktop); nginx arranca pero no en el 8080 de Fedora.
- Arreglo indicado: instalar Docker Engine junto a Desktop, `docker context use default`, levantar de nuevo con el compose de Fedora. FEDORA.md y el mensaje del diagnóstico ya traen los pasos en orden.

## Contraseña de `agua` (DBeaver 1045)
- Causa: `leer_env` tomaba el comentario al final de la línea (`DB_PASSWORD=clave   # nota`) como parte del valor; el ejemplo de FEDORA.md tenía uno. El usuario `agua` quedaba con otra contraseña.
- Arreglo: `leer_env` (bash) y el lector del simulador (Node) siguen las reglas de Docker Compose (comillas, comentario con espacio antes de `#`); verificado contra `docker compose config` con 7 formatos. `preparar-mariadb.sh` ahora también comprueba el acceso como DBeaver (`-h localhost`). Ejemplo de la guía sin comentarios en línea.
- Remedio para Marco: `git pull` + volver a correr `preparar-mariadb.sh` (corrige la contraseña con `ALTER USER`).

## ESP32 virtual
- `docs/js/esp32-virtual.js`: modelo físico compartido. Curvas PH-4502C (Nernst, ganancia x3), SEN0189 (polinomio DFRobot), Gravity TDS (cúbica DFRobot, saturación 2.3 V), DS18B20; divisores de PCB supuestos; ADC del ESP32 a 11 dB con ruido, no linealidad y 12 bits; sobremuestreo; mediana de 5 en turbidez; compensación por temperatura; calibraciones; fallas.
- `simulador/simular-esp32.js`: proceso que manda a la API real (y a ThingSpeak si hay `THINGSPEAK_WRITE_KEY`), con comandos en vivo. Perfil `simulador` en los dos compose.
- Laboratorio oculto en la página: Konami (↑↑↓↓←→←→BA), 5 toques en la gota o `#laboratorio`. Vaso SVG, cadena de la señal, fallas, calibración, monitor serie, x1/x10/x60, envío real a `/api/lecturas`, y "usar en toda la página" con aviso visible de **Simulación**.

## Hallazgos de la simulación (llevar a la presentación)
- **Turbidez:** cerca de agua limpia el SEN0189 cambia ~0.3 mV por NTU; un error de 0.4 % del ADC equivale a ~80 NTU. Sin calibrar con agua purificada no distingue agua turbia. Con calibración el ruido queda en ±1 NTU y puede haber un falso amarillo cerca de 4 NTU.
- **Conductividad baja:** el ADC del ESP32 casi no lee debajo de 150 mV, así que el agua muy pura se subestima.
- **Conductividad alta:** el módulo TDS se satura en 2.3 V (≈ 2240 µS/cm).

## Banco de preguntas para el encargado del ESP32
Doc compartible: https://claude.ai/artifact/CAQy86zZnp1ce2QgCnBRjt (hardware, conversión, calibración, firmware, errores, montaje y qué entregar). Las preguntas ★ bloquean la conexión real.

## Llaves y secretos
| Llave | Dónde va | Quién la crea |
|---|---|---|
| ThingSpeak Channel ID + Read API Key | `docs/js/config.js` (público) o Ajustes | Equipo, al crear el canal |
| ThingSpeak Write API Key | `esp32/secretos.h` y, opcional, `.env` (`THINGSPEAK_WRITE_KEY`) | Equipo |
| `ESP32_API_KEY` | `.env` y `secretos.h` | `python3 -c "import secrets; print(secrets.token_hex(16))"` |
| `DB_PASSWORD` (y `DB_ROOT_PASSWORD` solo en la variante Docker) | `.env` | Equipo |
| Token de Ubidots | Se retira | - |

Ninguna se manda por chat ni se sube a GitHub (`.env` y `secretos.h` están en `.gitignore`).

## Verificado
- Semáforo + ESP32 virtual: 17/17 pruebas (colores por muestra, error antes/después de calibrar, ruido en agua limpia, fallas, precarga, semilla, compatibilidad con la API).
- API: 9/9 contra MariaDB real, incluido un usuario con solo SELECT/INSERT/UPDATE (no puede crear ni borrar; error claro si falta una migración).
- Migraciones aplicadas dos veces sin error y sobre una base vieja. `preparar-mariadb.sh` y `respaldar.sh` (incluida la restauración) contra MariaDB real; `shellcheck` sin advertencias.
- Simulador de terminal → nginx (`nginx.fedora.conf`) → API → MariaDB: 201 y `estado_dispositivos` correcto.
- Navegador: Konami y 5 toques desbloquean; fallas → `null`; fuente simulador → semáforo "No apta" con aviso; envío desde el laboratorio → 201 en MariaDB; sin errores de consola.
- Los tres `docker compose config` válidos.

## No verificado (limitación del entorno)
- `docker compose up` real (sin acceso a Docker Hub), SELinux, firewalld y `sudo mariadb` en Fedora real.
- ThingSpeak real y el ESP32 físico.

## Sensores reales y conexión del ESP32 (2026-11-23)
- Sensores confirmados: ESP32-WROOM-32 DevKit 38 pines, PH-4502C (pH), Keyestudio TDS V1 (conductividad), DS18B20 (temperatura), HC-SR04T (nivel), TSW-10 (turbidez, **falta comprarlo**).
- Nuevo `esp32/README.md`: tabla de hardware, avisos de PCB (ADC1 con WiFi, echo de 5 V), paso a paso ESP32 → laptop, red del Tec y tabla de fallas.
- Nuevo `esp32/prueba_red/prueba_red.ino`: prueba WiFi, internet, `/api/salud` y un POST (`esp32-prueba-red`), cada 30 s.
- `envio_datos.ino`: `conectarWiFi()` con red normal o WPA2-Enterprise (PEAP, `WIFI_EMPRESARIAL` + `WIFI_USUARIO` en `secretos.h`).
- `.gitignore` cubre `esp32/**/secretos.h`.
- Red elegida para laptop y ESP32: **Tec-IoT** (2026-11-24). Verificar enlace con `probar-conexion.sh` (IP + API_URL) y `prueba_red.ino` ([3] OK y [4] 201). Si [2] OK pero [3] falla con firewall abierto, la red aísla clientes → ThingSpeak + puente.
- Documento de contexto (Claude Doc): https://claude.ai/artifact/PWt5AtjHv4iLadoLSZRJDB
- **No compilado**: los sketches no se pudieron compilar en el entorno (instalar arduino-cli fue denegado). La firma `WiFi.begin(ssid, WPA2_AUTH_PEAP, identidad, usuario, clave)` es la del core 2.0.3+; confirmar al compilar.
- Abierto: sin TSW-10 el semáforo queda gris (falta una variable); el nivel no está en página, API ni base; el laboratorio sigue modelando SEN0189 y Gravity TDS, no TSW-10 ni Keyestudio.

## ESP32 virtual retirado (2026-11-24)
- Pedido de Marco: eliminar el simulador y usar solo el ESP32 real.
- Borrados: `docs/js/esp32-virtual.js`, `docs/js/laboratorio.js`, `simulador/`, `tests/esp32-virtual.test.js`, la pantalla Laboratorio, el aviso de simulación, el toast, sus estilos, el servicio `simulador` de los dos compose y `SIM_*` del `.env.example`. Las secciones "ESP32 virtual" y "Hallazgos de la simulación" de este handoff quedan como historia.
- Página: la fuente "simulador" ya no existe; un navegador que la tenía guardada vuelve a la fuente por defecto (ThingSpeak) y limpia el filtro `esp32-sim`. Verificado en Chrome headless.
- Migración `004_retirar_simulador.sql`: borra lecturas, calibraciones y dispositivos `esp32-sim*` o `simulado = 1`. En Fedora la aplica `preparar-mariadb.sh` (como root); en Docker la API al arrancar. Probada con el migrador (Node) y con el cliente `mariadb`.
- API: `validar.js` rechaza `simulado: true` y dispositivos `esp32-sim*` (400). El puente no arranca con `PUENTE_DISPOSITIVO=esp32-sim*`.
- FEDORA.md Paso 10 y WINDOWS.md Paso 9 ahora son "Quitar el ESP32 virtual": respaldo, `docker rm -f calidad-agua-simulador`, migración, Clear Channel en ThingSpeak si el simulador publicó ahí.
- Pruebas: API 15/15 con MariaDB real (incluida la nueva de la 004), semáforo 8/8, compose válidos.
- **Abierto:** el ESP32 real no aparece en la terminal de Marco. No se sabe qué firmware tiene; falta su salida del monitor serie (no llegó adjunta).

## Pendiente del equipo
- Responder el banco de preguntas (divisores, fórmulas, pines) para el firmware real.
- FEDORA.md Paso 10 (quitar el simulador) y luego conectar el ESP32 real con `esp32/README.md`.
- Activar GitHub Pages.
- Wireframes y presentación (entregable de la actividad).
