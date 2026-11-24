# Roadmap · Página web del monitoreo de calidad del agua

**Actualizado:** 2026-11-24 · Complementa el roadmap de hardware de `TC1004B_proyecto_calidad_agua.md`.

### Fase 0 · Evaluación ✅
- [x] Revisar spec e instrucciones de la actividad.

### Fase 1 · Definición ✅
- [x] Plataforma de datos: ThingSpeak (Ubidots se mantiene).
- [x] 4 pantallas y regla del semáforo.
- [x] Umbrales de pH, turbidez y conductividad.

### Fase 2 · Maqueta y lógica ✅
- [x] HTML/CSS/JS con paleta azul y navegación por botones.
- [x] Modo demo con escenarios.
- [x] Semáforo con pruebas, gráficas, alertas, ajustes.
- [x] Docker para localhost.

### Fase 2.5 · Base de datos propia ✅
- [x] MariaDB + API Node en Docker (reemplaza Ubidots).
- [x] Fuente "MariaDB" en la página (localhost).
- [x] Firmware con envío a ThingSpeak y a la API.

### Fase 2.6 · Fedora + MariaDB local ✅
- [x] Compose para Fedora usando la MariaDB del equipo.
- [x] Scripts de preparación y prueba.
- [x] Guía FEDORA.md (terminal, DBeaver, ESP32).

### Fase 2.7 · Base v2 y ESP32 virtual ✅ (el simulador se retiró el 2026-11-24)
- [x] Migraciones, permisos mínimos, dispositivos, calibraciones, respaldos.
- [x] Modelo físico de sensores y ADC con pruebas.
- [x] Simulador de terminal y laboratorio oculto.
- [x] Banco de preguntas para el encargado del ESP32.

### Fase 3 · Conexión real ⏳ (equipo)
- [x] Retirar el ESP32 virtual (migración 004).
- [ ] Correr FEDORA.md Paso 10 en la laptop para borrar los datos simulados.
- [ ] Revisar el monitor serie del ESP32 real y lograr que aparezca en MariaDB.
- [ ] Recibir respuestas del banco de preguntas.
- [ ] En Fedora: seguir FEDORA.md Pasos 1 a 11.
- [ ] En Windows (compañeros): seguir WINDOWS.md y reportar cualquier error de los scripts .ps1 (no se pudieron ejecutar en el entorno de desarrollo).
- [ ] Decidir camino A (ESP32 → ThingSpeak + API) o B (ESP32 → ThingSpeak + puente).
- [x] Elegir la red de la demo: Tec-IoT.
- [ ] Compilar `esp32/prueba_red/prueba_red.ino` y correrlo en Tec-IoT.
- [ ] Comprar e instalar el TSW-10; mientras tanto, decidir si el semáforo evalúa solo pH y conductividad.
- [ ] Integrar el nivel del HC-SR04T (field5, columna en `lecturas`, tarjeta en Inicio).
- [ ] Actualizar el laboratorio a los sensores reales (TSW-10, Keyestudio TDS V1).
- [ ] Crear `.env` y levantar `docker compose` (Guía, Pasos 1 y 2).
- [ ] Crear canal ThingSpeak con field1 a field4 (Paso 3).
- [ ] Cambiar Ubidots por `enviarThingSpeak()` + `enviarAPI()` en el firmware (Paso 4).
- [ ] Verificar datos en ThingSpeak y MariaDB, conectar la página (Pasos 5 y 6).
- [ ] Probar con muestras reales (Paso 7).

### Fase 4 · Publicación ⏳
- [x] Subir el código al repo `IoT-interface-design-`.
- [ ] Activar GitHub Pages desde `/docs` (Paso 8).
- [ ] Poner Channel ID en `docs/js/config.js` para que arranque conectada.

### Fase 5 · Entregable de la actividad ⏳
- [ ] Wireframes de las 4 pantallas (pueden salir de capturas de la página).
- [ ] Presentación: resumen, interfaz, hardware, software y conectividad.
- [ ] PDF/PPT con nombres del equipo y nombre del proyecto.
