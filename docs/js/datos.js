/*
 * datos.js
 * Dos fuentes de lecturas con la misma forma de salida:
 *   - ThingSpeak (datos reales del ESP32)
 *   - Demo (datos simulados para presentar sin hardware)
 *
 * Cada lectura: { id, fecha: Date, ph, turbidez, conductividad, temperatura }
 * Un valor que no llegó queda como null.
 */
(function (raiz) {
  "use strict";

  function aNumero(v) {
    if (v === null || v === undefined || v === "") return null;
    var n = parseFloat(v);
    return isFinite(n) ? n : null;
  }

  // ---------- ThingSpeak ----------

  function urlThingSpeak(ts, resultados) {
    var url = "https://api.thingspeak.com/channels/" + encodeURIComponent(ts.channelId) +
              "/feeds.json?results=" + resultados;
    if (ts.readApiKey) url += "&api_key=" + encodeURIComponent(ts.readApiKey);
    return url;
  }

  function leerThingSpeak(config) {
    var ts = config.thingspeak;
    if (!ts.channelId) {
      return Promise.reject(new Error("Falta el Channel ID de ThingSpeak (pantalla Ajustes)."));
    }
    return fetch(urlThingSpeak(ts, config.resultados), { cache: "no-store" })
      .then(function (r) {
        if (r.status === 400 || r.status === 404) throw new Error("Canal no encontrado o Read API Key incorrecta.");
        if (!r.ok) throw new Error("ThingSpeak respondió " + r.status + ".");
        return r.json();
      })
      .then(function (json) {
        if (json === -1 || !json || !json.feeds) {
          throw new Error("El canal es privado: agrega la Read API Key en Ajustes.");
        }
        var c = config.campos;
        return {
          canal: json.channel ? json.channel.name : "",
          lecturas: json.feeds.map(function (f) {
            return {
              id: f.entry_id,
              fecha: new Date(f.created_at),
              ph: aNumero(f[c.ph]),
              turbidez: aNumero(f[c.turbidez]),
              conductividad: aNumero(f[c.conductividad]),
              temperatura: aNumero(f[c.temperatura])
            };
          })
        };
      });
  }

  // ---------- Demo ----------

  // Generador pseudoaleatorio con semilla: el demo se ve igual cada vez que se abre.
  function mulberry32(semilla) {
    return function () {
      semilla |= 0; semilla = semilla + 0x6D2B79F5 | 0;
      var t = Math.imul(semilla ^ semilla >>> 15, 1 | semilla);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  var ESCENARIOS = {
    limpia:     { ph: 7.3, turbidez: 1.6,  conductividad: 640 },
    precaucion: { ph: 7.4, turbidez: 6.8,  conductividad: 700 },
    noApta:     { ph: 9.2, turbidez: 14.0, conductividad: 1820 }
  };

  function crearDemo(intervaloSeg) {
    var rng = mulberry32(502);
    var paso = (intervaloSeg || 20) * 1000;
    var escenario = "limpia";
    var lecturas = [];
    var siguienteId = 1;

    function ruido(amp) { return (rng() - 0.5) * 2 * amp; }

    function punto(fecha, base) {
      return {
        id: siguienteId++,
        fecha: fecha,
        ph: +(base.ph + ruido(0.08)).toFixed(2),
        turbidez: +Math.max(0.1, base.turbidez + ruido(0.35)).toFixed(1),
        conductividad: Math.round(base.conductividad + ruido(25)),
        temperatura: +(22.4 + ruido(0.3)).toFixed(1)
      };
    }

    // Historial inicial de 100 lecturas con dos eventos para que Alertas tenga qué mostrar:
    // un pico de turbidez (amarillo) y luego pH alto + turbidez alta (rojo).
    var ahora = Date.now();
    for (var i = 0; i < 100; i++) {
      var b = { ph: 7.25 + Math.sin(i / 9) * 0.25, turbidez: 1.5 + Math.sin(i / 6) * 0.6, conductividad: 630 + Math.sin(i / 14) * 60 };
      if (i >= 30 && i <= 36) b.turbidez = 6.2;
      if (i >= 58 && i <= 61) { b.ph = 8.9; b.turbidez = 7.5; }
      lecturas.push(punto(new Date(ahora - (99 - i) * paso), b));
    }

    return {
      ESCENARIOS: ESCENARIOS,
      escenario: function () { return escenario; },
      cambiarEscenario: function (nombre) {
        if (!ESCENARIOS[nombre]) return;
        escenario = nombre;
        lecturas.push(punto(new Date(), ESCENARIOS[nombre]));
        if (lecturas.length > 100) lecturas.shift();
      },
      leer: function (resultados) {
        var ultima = lecturas[lecturas.length - 1];
        if (Date.now() - ultima.fecha.getTime() >= paso * 0.9) {
          lecturas.push(punto(new Date(), ESCENARIOS[escenario]));
          if (lecturas.length > 100) lecturas.shift();
        }
        return Promise.resolve({ canal: "Demo", lecturas: lecturas.slice(-resultados) });
      }
    };
  }

  raiz.Datos = {
    leerThingSpeak: leerThingSpeak,
    urlThingSpeak: urlThingSpeak,
    crearDemo: crearDemo
  };
})(window);
