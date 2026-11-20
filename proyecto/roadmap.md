# Roadmap · Página web del monitoreo de calidad del agua

**Actualizado:** 2026-11-20 · Complementa el roadmap de hardware de `TC1004B_proyecto_calidad_agua.md`.

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

### Fase 3 · Conexión real ⏳ (equipo)
- [ ] Crear canal ThingSpeak con field1 a field4 (Guía, Paso 2).
- [ ] Agregar `enviarThingSpeak()` al firmware (Paso 3).
- [ ] Conectar la página y probar (Paso 4).
- [ ] Probar con muestras reales (Paso 5).

### Fase 4 · Publicación ⏳
- [ ] Crear repo y activar GitHub Pages desde `/docs` (Paso 6).
- [ ] Poner Channel ID en `docs/js/config.js` para que arranque conectada.

### Fase 5 · Entregable de la actividad ⏳
- [ ] Wireframes de las 4 pantallas (pueden salir de capturas de la página).
- [ ] Presentación: resumen, interfaz, hardware, software y conectividad.
- [ ] PDF/PPT con nombres del equipo y nombre del proyecto.
