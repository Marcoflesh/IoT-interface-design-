/*
 * datos.js
 * Dos fuentes de lecturas del ESP32, con la misma forma de salida:
 *   - ThingSpeak (canal privado: usa la Read API Key; funciona en GitHub Pages)
 *   - API propia con MariaDB (solo en localhost con Docker)
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

  // El límite incluye la lectura del cuerpo de la respuesta y libera el siguiente intento.
  async function consultar(url, leerRespuesta) {
    var control = new AbortController();
    var limite = setTimeout(function () { control.abort(); }, 12000);
    try {
      var respuesta = await fetch(url, { cache: "no-store", signal: control.signal });
      return await leerRespuesta(respuesta);
    } catch (e) {
      if (control.signal.aborted) throw new Error("La fuente tardó demasiado en responder. Vuelve a intentar la conexión.");
      throw e;
    } finally {
      clearTimeout(limite);
    }
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
    return consultar(urlThingSpeak(ts, config.resultados), function (r) {
      if (r.status === 400 || r.status === 404) throw new Error("Canal no encontrado o Read API Key incorrecta.");
      if (!r.ok) throw new Error("ThingSpeak respondió " + r.status + ".");
      return r.json();
    })
      .then(function (json) {
        if (json === -1 || !json || !json.feeds) {
          throw new Error("El canal es privado: falta la Read API Key o no es la de este canal (Ajustes).");
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

  // ---------- API propia (MariaDB) ----------

  function baseAPI(config) {
    return (config.api && config.api.url ? config.api.url : "").replace(/\/$/, "");
  }

  function leerAPI(config) {
    // La base solo tiene un dispositivo (esp32-1): lo directo y lo copiado de ThingSpeak.
    return consultar(baseAPI(config) + "/api/lecturas?limit=" + config.resultados, function (r) {
      if (r.status === 404) throw new Error("No se encontró la API. Solo funciona en localhost con Docker (http://localhost:8080).");
      if (r.status === 503) throw new Error("La API no puede conectarse a MariaDB. Revisa: docker compose ps");
      if (!r.ok) throw new Error("La API respondió " + r.status + ".");
      return r.json();
    })
      .then(function (json) {
        return {
          canal: "MariaDB",
          lecturas: json.lecturas.map(function (l) {
            return {
              id: l.id,
              fecha: new Date(l.fecha),
              ph: aNumero(l.ph),
              turbidez: aNumero(l.turbidez),
              conductividad: aNumero(l.conductividad),
              temperatura: aNumero(l.temperatura)
            };
          })
        };
      });
  }

  function saludAPI(config) {
    return consultar(baseAPI(config) + "/api/salud", function (r) {
      if (r.status === 404) throw new Error("No se encontró la API. Solo funciona en localhost con Docker (http://localhost:8080).");
      return r.json().then(function (j) {
        if (!r.ok || !j.ok) throw new Error(j.error || "La API no responde.");
        return j;
      });
    });
  }

  raiz.Datos = {
    leerThingSpeak: leerThingSpeak,
    leerAPI: leerAPI,
    saludAPI: saludAPI,
    urlThingSpeak: urlThingSpeak
  };
})(window);
