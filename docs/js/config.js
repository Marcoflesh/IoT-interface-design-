/*
 * config.js
 * Valores por defecto de la página. Lo que se cambie en la pantalla "Ajustes"
 * se guarda en el navegador (localStorage) y tiene prioridad sobre esto.
 *
 * IMPORTANTE: aquí solo va la READ API KEY de ThingSpeak (solo lectura).
 * La WRITE API KEY vive únicamente en el firmware del ESP32. Nunca en la página.
 */
window.APP_CONFIG = {
  // "demo", "thingspeak" o "api" (MariaDB, solo en localhost con Docker)
  fuente: "demo",

  thingspeak: {
    channelId: "",     // ej. "2741234"
    readApiKey: ""     // vacío si el canal es público
  },

  // API propia (MariaDB). Vacío = el mismo servidor que sirve la página (Docker, localhost:8080).
  api: {
    url: ""
  },

  // Qué field del canal de ThingSpeak corresponde a cada variable.
  // Debe coincidir con el firmware del ESP32.
  campos: {
    ph: "field1",
    turbidez: "field2",
    conductividad: "field3",
    temperatura: "field4"
  },

  intervaloSeg: 20,     // cada cuánto consulta la página (mín. 15: límite de ThingSpeak gratis)
  minutosSinDatos: 3,   // si la última lectura es más vieja, el semáforo pasa a gris
  resultados: 100,      // lecturas que se descargan para historial y alertas
  criticoRojo: false    // true = una sola variable en nivel crítico pone el semáforo en rojo
};
