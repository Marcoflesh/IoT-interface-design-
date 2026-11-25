# Traceability · Web IoT · Calidad del agua

**Actualizado:** 2026-11-24 (ESP32 virtual retirado)

## Pantallas
| # | Pantalla | Propósito | Navegación |
|---|---|---|---|
| P1 | Inicio | Semáforo, conteo de parámetros en rango (de 4), 4 tarjetas con medidor | Tarjeta → P2 de esa variable |
| P2 | Historial | Gráfica con banda de rango, puntos fuera de rango, estadísticas, tabla | Botones de variable y de 20/50/100 lecturas |
| P3 | Alertas | Distribución de estados y lista de cambios de color con filtros | Insignia en el menú con el número de alertas |
| P4 | Ajustes | Fuente (ThingSpeak/MariaDB), Channel ID, Read Key, dispositivo, intervalo, umbrales, crítico |

## Matriz requisito → implementación
| ID | Fuente | Requisito | Dónde se cumple | Estado |
|---|---|---|---|---|
| R1 | Actividad §3 | 3 a 5 pantallas | P1 a P4 | ✅ Hecho |
| R2 | Actividad §3 | Nombre, elementos, info, interacciones, navegación por pantalla | Tabla de arriba + página | ✅ Hecho (falta pasarlo a wireframes) |
| R3 | Usuario | Semáforo con pH, turbidez, conductividad y temperatura | `semaforo.js`, P1 | ✅ Hecho (4 parámetros desde R44) |
| R4 | Usuario | Verde 4/4 en rango, amarillo 3 o 2/4, rojo 1 o 0/4 | `clasificar()` + 11 pruebas | ✅ Hecho (regla nueva R44) |
| R5 | Usuario | Definir parámetros de calidad | NOM-127-SSA1-2021 + conductividad derivada | ✅ Hecho |
| R6 | Spec §5 | Gráficas y tendencias | P2 | ✅ Hecho |
| R7 | Spec §5 | Alertas | P3 | ✅ Hecho |
| R8 | Spec §2 | Temperatura (compensación) | P1 nota, field4 | ✅ Hecho (informativa) |
| R9 | Instrucciones | Página simple con botones interactivos | Menú, segmentados, acciones | ✅ Hecho |
| R10 | Instrucciones | Paleta azul de neutro a oscuro | `styles.css` | ✅ Hecho |
| R11 | Usuario | Localhost con Docker | `Dockerfile`, `docker-compose.yml` | ⚠️ Hecho, sin probar en este entorno |
| R12 | Usuario | GitHub Pages | Carpeta `docs/` + `index.html` raíz que redirige | ✅ Publicado y verificado en /docs/ |
| R13 | Usuario | ThingSpeak | `datos.js`, Ajustes, `esp32/calidad_agua/calidad_agua.ino` | ⚠️ Hecho, falta prueba con canal real |
| R14 | Usuario | Guía paso a paso | `README.md` | ✅ Hecho |
| R15 | Actividad §4 | Presentación de 4 slides | Fuera de la página | ⏳ Pendiente |
| R16 | Actividad §6 | PDF/PPT con wireframes, equipo, nombre | Fuera de la página | ⏳ Pendiente |
| R17 | Usuario | MariaDB en lugar de Ubidots | `api/`, `docker-compose.yml` (servicio `db`) | ✅ Hecho (probado con MariaDB real) |
| R18 | Usuario | ESP32 guarda en MariaDB de forma segura | `POST /api/lecturas` + `X-API-Key`, `esp32/calidad_agua/calidad_agua.ino` | ✅ Hecho (ESP32 simulado) |
| R19 | Usuario | GitHub Pages sigue funcionando | La página publicada lee de ThingSpeak | ✅ Hecho |
| R21 | Usuario | Usar la MariaDB local de Fedora (terminal y DBeaver) | `docker-compose.fedora.yml`, `scripts/fedora/preparar-mariadb.sh`, FEDORA.md Pasos 4 a 6 | ✅ Hecho (probado sin SELinux/firewalld) |
| R22 | Usuario | Paso a paso completo para que funcione el ESP32 en Fedora | FEDORA.md Pasos 1 a 9, `probar-conexion.sh` | ✅ Hecho |
| R23 | Usuario | Base de datos como la haría un senior | Migraciones, permisos mínimos, `dispositivos`, `calibraciones`, diagnóstico, vistas, respaldos | ✅ Hecho (probado con MariaDB real) |
| R24 | Usuario | Banco de preguntas para el encargado del ESP32 | Doc compartible (8 secciones, preguntas ★ que bloquean) | ✅ Hecho |
| R25 | Usuario | Generar todo como si el ESP32 estuviera conectado | Simulador de terminal → API → MariaDB (y ThingSpeak opcional) | 🗑️ Retirado (R36) |
| R26 | Usuario | Página oculta tipo easter egg con sensores simulados lo más realista posible | `laboratorio.js` + `esp32-virtual.js` (curvas de módulos, ADC, firmware, fallas) | 🗑️ Retirado (R36) |
| R27 | Usuario | Página funcionando sin hardware | Fuente "simulador" en toda la página, con aviso de simulación | 🗑️ Retirado (R36) |
| R28 | Usuario | Qué API keys se necesitan | Tabla de llaves en handoff y respuesta | ✅ Hecho |
| R29 | Usuario | Resolver error 1045 de root al preparar MariaDB en Fedora | `lib-mariadb.sh`, FEDORA.md (contraseñas, SHOW TABLES, recuperación) | ✅ Hecho (reproducido y probado) |
| R30 | Usuario | Conectar ThingSpeak con MariaDB | Puente `puente-thingspeak.js` + migración 003 + perfil `thingspeak`; FEDORA.md Paso 11 | ✅ Hecho (probado con ThingSpeak falso) |
| R31 | Usuario | Guía equivalente a FEDORA.md para Windows y PowerShell | WINDOWS.md + `scripts/windows/*.ps1` + puertos configurables | ✅ Hecho (SQL probado; .ps1 sin ejecutar) |
| R32 | Usuario | Documento con el contexto de la página y lo que hace el ESP32 | Claude Doc "Monitoreo de calidad del agua · Qué hace la página y el ESP32" (diagrama de flujo, sensores, semáforo, pantallas, datos, estado) | ✅ Hecho |
| R33 | Usuario | Registrar los sensores reales (TSW-10, Keyestudio TDS V1, DS18B20, PH-4502C, HC-SR04T) | `esp32/README.md`, documento de contexto | ✅ Hecho (TSW-10 pendiente de compra; nivel aún no integrado) |
| R34 | Usuario | Paso a paso para conectar el ESP32 a la IP de la laptop o a la red del Tec | `esp32/README.md`, `prueba_red.ino`, `conectarWiFi()` con WPA2-Enterprise, sección en el documento | ⚠️ Escrito, sin compilar ni probar en hardware |
| R20 | Spec §6 Fase 6 | Analizar datos y tendencias | Vista `resumen_diario`, consultas SQL, Adminer, exportar CSV | ✅ Hecho |
| R35 | Usuario | Saber si laptop y ESP32 están enlazados en la red Tec-IoT | Respuesta paso a paso con `probar-conexion.sh`, `prueba_red.ino` y `ping` | ⏳ Falta que el equipo lo corra |
| R36 | Usuario | Eliminar el ESP32 simulado y usar solo el real | Borrado de laboratorio/simulador, migración 004, API rechaza simulados, guías actualizadas | ✅ Hecho (probado con MariaDB real y Chrome) |
| R37 | Usuario | El ESP32 real no aparece en la terminal | Causa: sin `X-API-Key` (401) y campos `tds`/`distancia`. Firmware `calidad_agua.ino` corregido | ⚠️ Corregido, falta subirlo al ESP32 |
| R38 | Usuario (firmware) | Guardar la distancia del HC-SR04T | Migración 005 | 🗑️ Retirado (R40) |
| R39 | Usuario | Solo `esp32-1`: borrar `esp32-sim`, `prueba-terminal`, `esp-32-sim`; ThingSpeak llega al mismo `esp32-1` sin duplicar | Migración 006, `validar.js`, `app.js` (ts_entry_id), puente, firmware v1.2.0, `probar-conexion` sin escribir | ✅ Hecho (19/19 con MariaDB real) |
| R40 | Usuario | Quitar `distancia` de la base | Migración 006 (`DROP COLUMN`), API, puente, `ver-mariadb`, firmware | ✅ Hecho |
| R41 | Usuario | Temperatura en la base | Columna `lecturas.temperatura` (desde 001); el firmware la manda | ✅ Ya existía |
| R42 | Usuario | Configurar la página para un solo dispositivo | Sin campo "Dispositivo en MariaDB" en Ajustes, sin filtro en `datos.js` | ✅ Hecho (Chrome) |
| R43 | Usuario | Eliminar el laboratorio | Ya retirado en R36 | ✅ Hecho |
| R44 | Usuario | Semáforo de 4 parámetros: verde 4/4, amarillo 3-2/4, rojo 1-0/4 | `semaforo.js`, textos de Inicio y Ajustes, `ver-mariadb` en SQL | ✅ Hecho (11 pruebas) |
| R45 | Usuario | Temperatura en la página, el semáforo y las gráficas | Tarjeta, Historial (botón, gráfica, tabla), umbrales 10 a 30 °C editables | ✅ Hecho (Chrome) |
| R46 | Usuario | Quitar simulación y labs de la página | Modo demo eliminado (control, fuente, generador, `--demo`) | ✅ Hecho |
| R47 | Usuario | Canal nuevo privado con Read API Key | `configurar-pagina` exige Read Key; puente y página la usan; guías | ✅ Hecho |
| R48 | Usuario | Borrar la base vieja y crear una nueva limpia | `scripts/fedora/base-nueva.sh` | ✅ Hecho (probado con MariaDB real) |
| R49 | Usuario | Que no se mezclen/dupliquen ThingSpeak y lo directo | entry_id único + `origen`; revisión de repetidos en `ver-mariadb` y DBeaver | ✅ Hecho (5 entradas → 5 filas) |
| R50 | Usuario | Paso a paso completo en un archivo nuevo + FEDORA.md | `PUESTA_EN_MARCHA.md`, FEDORA.md Paso 12 | ✅ Hecho |
| R51 | Usuario | probar-thingspeak dice que falta la Read Key aunque está puesta | Diagnóstico en `probar-thingspeak.sh` (ruta, repetidas, formato, Write Key, rechazo) | ✅ Hecho (6 casos con ThingSpeak falso) |
