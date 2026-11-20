# Handoff · Web IoT · Monitoreo de calidad del agua (TC1004B)

**Fecha:** 2026-11-20 · **Último prompt:** conectar a la MariaDB local de Fedora (terminal y DBeaver) y dejar listo el ESP32

## Repositorio
- https://github.com/Marcoflesh/IoT-interface-design- · rama `main`.
- GitHub Pages aún **no** está activado: Settings → Pages → `main` / `/docs`. URL esperada: https://marcoflesh.github.io/IoT-interface-design-/

## Arquitectura actual
```
ESP32 ─HTTPS─► ThingSpeak ─► página (GitHub Pages y localhost)
      └─HTTP LAN─► nginx /api ─► API Node/Express ─► MariaDB 11.4 ─► página (solo localhost)
```
Ubidots se retira. Docker Compose levanta 4 servicios: `web` (8080), `api` (interna), `db` (127.0.0.1:3306), `adminer` (127.0.0.1:8081).

## Variante Fedora (MariaDB instalada en la laptop)
- `docker-compose.fedora.yml`: solo `api` y `web`, ambos con `network_mode: host`. La API entra a MariaDB en 127.0.0.1:3306 y escucha solo en 127.0.0.1:3000; nginx expone 8080 para el ESP32. Volúmenes con `:z` por SELinux.
- `scripts/fedora/preparar-mariadb.sh`: crea base y usuario (`localhost` y `127.0.0.1`), carga el esquema, abre 8080 en firewalld e imprime datos para DBeaver y el `API_URL` del ESP32. Idempotente.
- `scripts/fedora/probar-conexion.sh`: prueba contenedores, página, API, MariaDB, llave falsa (401) y acceso por la IP de la red; `--limpiar` borra las lecturas de prueba.
- Guía `FEDORA.md`: Docker en Fedora, MariaDB, `.env`, terminal, DBeaver, ESP32 (grupo dialout), uso diario y problemas comunes.

## Qué se entregó
- **Página** (`docs/`): 4 pantallas, paleta azul, 3 fuentes de datos (ThingSpeak, MariaDB, demo).
- **API** (`api/`): `POST /api/lecturas` con header `X-API-Key`, `GET /api/lecturas?limit=`, `GET /api/salud`. Valida tipos y rangos físicos; acepta `null` para sensores caídos.
- **Base**: tabla `lecturas` (fecha UTC, dispositivo, 4 variables) y vista `resumen_diario`. El esquema se crea solo al arrancar.
- **Firmware** (`esp32/envio_datos.ino`): `enviarThingSpeak()` y `enviarAPI()`, llaves en `secretos.h` (ignorado por git).
- **Guía** paso a paso en `README.md` (9 pasos + solución de problemas + consultas SQL).

## Decisiones
| Decisión | Motivo |
|---|---|
| MariaDB reemplaza a Ubidots, ThingSpeak se queda | GitHub Pages necesita una fuente pública HTTPS; MariaDB solo vive en la laptop. |
| API entre el ESP32 y MariaDB | No exponer usuario/contraseña de la base en el firmware ni abrir el puerto 3306. |
| ESP32 → nginx:8080/api (no al puerto de la API) | Un solo puerto abierto en la red local; la página usa el mismo origen, sin CORS. |
| Puertos de MariaDB y Adminer solo en 127.0.0.1 | Nadie más en la red WiFi puede entrar a la base. |
| Fechas en UTC | Evita confusiones de zona horaria; la página convierte a hora local. |
| Semáforo: verde 3 en rango, amarillo 1 fuera, rojo 2-3 fuera, gris sin datos | Regla del equipo + estado gris para datos viejos. |
| pH 6.5 a 8.5, turbidez ≤ 4 NTU, conductividad 50 a 1500 µS/cm | NOM-127-SSA1-2021; conductividad derivada del límite de SDT. |

## Verificado
- Semáforo: 8/8 pruebas. API: 5/5 pruebas, incluida una de integración contra **MariaDB real** (inserción, lectura, `null`, fechas UTC, llave incorrecta, JSON con `nan`, vista).
- De punta a punta con **nginx real usando el mismo `nginx.conf`**: 40 lecturas simuladas del ESP32 por `/api` (40/40 guardadas), página leyendo de MariaDB con semáforo, alertas y "Probar conexión" correctos.
- `docker compose config` válido.

- Variante Fedora: `preparar-mariadb.sh` corrido dos veces contra MariaDB real (sin errores); API con `HOST=127.0.0.1` + nginx con `nginx.fedora.conf`; `probar-conexion.sh` pasó las 8 revisiones; `shellcheck` sin advertencias; `docker compose -f docker-compose.fedora.yml config` válido con SELinux `z`.

## No verificado (limitación del entorno)
- Fedora real: SELinux, firewalld y `sudo mariadb` por socket no existen en el entorno de prueba (Ubuntu). Los scripts detectan y avisan si falta algo.
- `docker compose up` completo: el entorno no tiene acceso a Docker Hub para bajar las imágenes. Los mismos archivos se probaron con MariaDB, Node y nginx instalados directamente.
- ThingSpeak real y el ESP32 físico.

## Pendiente del equipo
- Pasos 1 a 6 de la guía con el hardware real.
- Decidir si se activa "crítico = rojo".
- Activar GitHub Pages.
- Wireframes y presentación de 4 slides (entregable de la actividad).
