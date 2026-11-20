/*
 * semaforo.js
 * Lógica pura del semáforo de calidad del agua (sin DOM).
 * Se usa en el navegador (window.Semaforo) y en Node para las pruebas.
 *
 * Regla del equipo:
 *   verde    = las 3 variables dentro de rango
 *   amarillo = 1 variable fuera de rango
 *   rojo     = 2 o 3 variables fuera de rango
 *   gris     = falta al menos una lectura (no se puede evaluar)
 * Opcional: "crítico = rojo directo" si una sola variable rebasa su límite crítico.
 */
(function (raiz) {
  "use strict";

  // Umbrales por defecto.
  // pH y turbidez: NOM-127-SSA1-2021 (pH 6.5 a 8.5, turbiedad máx. 4 UNT).
  // Conductividad: la norma no la fija; se deriva del límite de SDT (1000 mg/L)
  // con factor TDS ≈ 0.65 x EC  →  ≈ 1500 µS/cm. Mínimo 50 µS/cm (spec del equipo):
  // abajo de eso casi siempre es la sonda fuera del agua o desconectada.
  // Límites críticos: propuesta del equipo, ajustables en la pantalla Ajustes.
  var UMBRALES_DEFECTO = {
    ph:            { min: 6.5, max: 8.5,  critMin: 6.0, critMax: 9.0 },
    turbidez:      { min: 0,   max: 4,    critMin: null, critMax: 50 },
    conductividad: { min: 50,  max: 1500, critMin: null, critMax: 3000 }
  };

  var VARIABLES = {
    ph:            { nombre: "pH",            unidad: "",      decimales: 2, escalaMin: 0, escalaMax: 14 },
    turbidez:      { nombre: "Turbidez",      unidad: "NTU",   decimales: 1, escalaMin: 0, escalaMax: 20 },
    conductividad: { nombre: "Conductividad", unidad: "µS/cm", decimales: 0, escalaMin: 0, escalaMax: 3000 }
  };

  var CLAVES = ["ph", "turbidez", "conductividad"];

  function esNumero(v) {
    return typeof v === "number" && isFinite(v);
  }

  // Devuelve "ok", "fuera", "critico" o "sin-dato" para una sola variable.
  function evaluarVariable(valor, u) {
    if (!esNumero(valor)) return "sin-dato";
    if ((esNumero(u.critMin) && valor < u.critMin) || (esNumero(u.critMax) && valor > u.critMax)) {
      return "critico";
    }
    if ((esNumero(u.min) && valor < u.min) || (esNumero(u.max) && valor > u.max)) {
      return "fuera";
    }
    return "ok";
  }

  // lectura: { ph, turbidez, conductividad }
  // umbrales: mismo formato que UMBRALES_DEFECTO
  // opciones: { criticoRojo: boolean }
  function clasificar(lectura, umbrales, opciones) {
    umbrales = umbrales || UMBRALES_DEFECTO;
    opciones = opciones || {};
    var resultado = { estado: "gris", fuera: [], criticos: [], faltantes: [], detalle: {}, enRango: 0 };

    for (var i = 0; i < CLAVES.length; i++) {
      var k = CLAVES[i];
      var e = evaluarVariable(lectura ? lectura[k] : null, umbrales[k]);
      resultado.detalle[k] = e;
      if (e === "sin-dato") resultado.faltantes.push(k);
      else if (e === "ok") resultado.enRango++;
      else {
        resultado.fuera.push(k);
        if (e === "critico") resultado.criticos.push(k);
      }
    }

    if (resultado.faltantes.length > 0) {
      resultado.estado = "gris";
    } else if (opciones.criticoRojo && resultado.criticos.length > 0) {
      resultado.estado = "rojo";
    } else if (resultado.fuera.length === 0) {
      resultado.estado = "verde";
    } else if (resultado.fuera.length === 1) {
      resultado.estado = "amarillo";
    } else {
      resultado.estado = "rojo";
    }
    return resultado;
  }

  // true si la lectura es más vieja que `minutos` (el ESP32 dejó de enviar).
  function estaVencida(fecha, ahora, minutos) {
    if (!(fecha instanceof Date) || isNaN(fecha.getTime())) return true;
    return (ahora.getTime() - fecha.getTime()) > minutos * 60 * 1000;
  }

  var Semaforo = {
    UMBRALES_DEFECTO: UMBRALES_DEFECTO,
    VARIABLES: VARIABLES,
    CLAVES: CLAVES,
    evaluarVariable: evaluarVariable,
    clasificar: clasificar,
    estaVencida: estaVencida
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Semaforo;
  } else {
    raiz.Semaforo = Semaforo;
  }
})(typeof window !== "undefined" ? window : this);
