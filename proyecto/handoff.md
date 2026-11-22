# Handoff · Web IoT · Monitoreo de calidad del agua (TC1004B)

**Fecha:** 2026-11-21 · **Último prompt:** error 1045 (Access denied for user root@localhost) al preparar MariaDB en Fedora

## Repositorio
- https://github.com/Marcoflesh/IoT-interface-design- · rama `main`.
- GitHub Pages aún **no** está activado: Settings → Pages → `main` / `/docs`. URL esperada: https://marcoflesh.github.io/IoT-interface-design-/

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

## Pendiente del equipo
- Responder el banco de preguntas y ajustar los supuestos de `esp32-virtual.js` (divisores, fórmulas, pines).
- FEDORA.md Pasos 1 a 10 con el hardware real; borrar datos `esp32-sim` antes de medir.
- Activar GitHub Pages.
- Wireframes y presentación (entregable de la actividad).
