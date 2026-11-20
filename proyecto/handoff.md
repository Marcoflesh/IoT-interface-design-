# Handoff · Web IoT · Monitoreo de calidad del agua (TC1004B)

**Fecha:** 2026-11-20 · **Prompt:** construir la página (Docker + GitHub Pages + ThingSpeak) y definir el semáforo

## Qué se entregó
- Página completa en `docs/`: 4 pantallas (Inicio, Historial, Alertas, Ajustes), HTML/CSS/JS sin frameworks, paleta azul de neutro a oscuro, navegación por botones (lateral en escritorio, inferior en móvil).
- Fuente de datos: **ThingSpeak** (Read API) con **modo demo** que incluye 3 escenarios (limpia, 1 fuera, no apta) para presentar sin hardware.
- Localhost con **Docker** (nginx, puerto 8080, `docs/` montada en vivo).
- Listo para **GitHub Pages** (rama `main`, carpeta `/docs`, `.nojekyll`).
- Fragmento de firmware `esp32/thingspeak_envio.ino` para enviar a ThingSpeak **además** de Ubidots.
- Guía paso a paso en `README.md`.
- Pruebas de la lógica del semáforo: 8/8 pasan (`node --test tests/*.test.js`).

## Decisiones
| Decisión | Motivo |
|---|---|
| Mantener Ubidots y agregar ThingSpeak | No romper lo que ya funciona. ThingSpeak tiene Read API Key separada (solo lectura), segura para una página pública. |
| Semáforo por conteo: 0 fuera verde, 1 amarillo, 2-3 rojo | Regla definida por el equipo. |
| Estado gris | Evita mostrar verde con datos viejos (más de 3 min) o incompletos. |
| pH 6.5 a 8.5, turbidez ≤ 4 NTU | NOM-127-SSA1-2021. |
| Conductividad 50 a 1500 µS/cm | La NOM no la fija; se deriva de SDT 1000 mg/L (factor ≈ 0.65). Mínimo 50 detecta sonda fuera del agua. |
| "Crítico = rojo" opcional y apagado | Con la regla de conteo, un pH de 3 solo da amarillo. Se dejó como opción para que el equipo decida. |
| Chart.js local (no CDN) | Funciona igual en localhost y Pages; una dependencia menos de red. |
| Ajustes en localStorage + `config.js` | Cada navegador guarda sus ajustes; `config.js` define con qué arranca la versión publicada. |

## Verificado
- Las 4 pantallas en escritorio (1366 px) y móvil (390 px) con capturas.
- Escenarios demo verde, amarillo y rojo; alertas y distribución de estados.
- Validación de Ajustes y manejo de error de conexión.
- Contraste WCAG de los pares de color del tema (todos los textos ≥ 4.5:1).

## No verificado (limitación del entorno de trabajo)
- `docker compose up` no se pudo correr: el entorno no tiene acceso a Docker Hub. Los mismos archivos se sirvieron con un servidor local y funcionan.
- Conexión real a ThingSpeak: el entorno bloquea la salida a api.thingspeak.com. Probar con el Paso 4 de la guía.

## Pendiente del equipo
- Crear el canal de ThingSpeak y agregar el envío al firmware (Pasos 2 y 3).
- Decidir si se activa "crítico = rojo".
- Wireframes y presentación de 4 slides (entregable de la actividad).
- Nombre final del proyecto y nombres del equipo.
