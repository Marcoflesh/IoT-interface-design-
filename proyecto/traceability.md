# Traceability · Web IoT · Calidad del agua

**Actualizado:** 2026-11-20

## Pantallas
| # | Pantalla | Propósito | Navegación |
|---|---|---|---|
| P1 | Inicio | Semáforo, conteo de variables en rango, 3 tarjetas con medidor, temperatura, control demo | Tarjeta → P2 de esa variable |
| P2 | Historial | Gráfica con banda de rango, puntos fuera de rango, estadísticas, tabla | Botones de variable y de 20/50/100 lecturas |
| P3 | Alertas | Distribución de estados y lista de cambios de color con filtros | Insignia en el menú con el número de alertas |
| P4 | Ajustes | Fuente (demo/ThingSpeak), Channel ID, Read Key, intervalo, umbrales, crítico | Guardar, Probar conexión, Restaurar |

## Matriz requisito → implementación
| ID | Fuente | Requisito | Dónde se cumple | Estado |
|---|---|---|---|---|
| R1 | Actividad §3 | 3 a 5 pantallas | P1 a P4 | ✅ Hecho |
| R2 | Actividad §3 | Nombre, elementos, info, interacciones, navegación por pantalla | Tabla de arriba + página | ✅ Hecho (falta pasarlo a wireframes) |
| R3 | Usuario | Semáforo con pH, turbidez, conductividad | `semaforo.js`, P1 | ✅ Hecho |
| R4 | Usuario | Verde 3 en rango, amarillo 1 fuera, rojo 2-3 fuera | `clasificar()` + 8 pruebas | ✅ Hecho |
| R5 | Usuario | Definir parámetros de calidad | NOM-127-SSA1-2021 + conductividad derivada | ✅ Hecho |
| R6 | Spec §5 | Gráficas y tendencias | P2 | ✅ Hecho |
| R7 | Spec §5 | Alertas | P3 | ✅ Hecho |
| R8 | Spec §2 | Temperatura (compensación) | P1 nota, field4 | ✅ Hecho (informativa) |
| R9 | Instrucciones | Página simple con botones interactivos | Menú, segmentados, acciones | ✅ Hecho |
| R10 | Instrucciones | Paleta azul de neutro a oscuro | `styles.css` | ✅ Hecho |
| R11 | Usuario | Localhost con Docker | `Dockerfile`, `docker-compose.yml` | ⚠️ Hecho, sin probar en este entorno |
| R12 | Usuario | GitHub Pages | Carpeta `docs/`, guía Paso 6 | ✅ Listo para publicar |
| R13 | Usuario | ThingSpeak | `datos.js`, Ajustes, `esp32/thingspeak_envio.ino` | ⚠️ Hecho, falta prueba con canal real |
| R14 | Usuario | Guía paso a paso | `README.md` | ✅ Hecho |
| R15 | Actividad §4 | Presentación de 4 slides | Fuera de la página | ⏳ Pendiente |
| R16 | Actividad §6 | PDF/PPT con wireframes, equipo, nombre | Fuera de la página | ⏳ Pendiente |
