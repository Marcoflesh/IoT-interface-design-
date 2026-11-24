// Puente ThingSpeak → MariaDB.
// Cada PUENTE_INTERVALO segundos lee las lecturas nuevas del canal y las copia a la tabla lecturas
// (origen = 'thingspeak') como dispositivo esp32-1. No duplica: usa el entry_id de ThingSpeak, también
// el que el ESP32 manda junto con su lectura directa a la API. Si la laptop estuvo apagada,
// al volver trae lo que falta (hasta las últimas 8000 entradas que guarda el canal) con su hora original.
//
//   node src/puente-thingspeak.js
//
// Variables: THINGSPEAK_CHANNEL_ID, THINGSPEAK_READ_KEY (si el canal es privado),
// PUENTE_INTERVALO, TS_CAMPO_PH/TURBIDEZ/CONDUCTIVIDAD/TEMPERATURA y las DB_* de la API.
"use strict";

const { validarLectura, DISPOSITIVO } = require("./validar");

const MAX_THINGSPEAK = 8000;   // lo más que entrega ThingSpeak por consulta

function aNumero(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Una entrada de ThingSpeak → fila para MariaDB (o el motivo por el que se descarta).
function feedALectura(feed, campos) {
  const { lectura, error } = validarLectura({
    ph: aNumero(feed[campos.ph]),
    turbidez: aNumero(feed[campos.turbidez]),
    conductividad: aNumero(feed[campos.conductividad]),
    temperatura: aNumero(feed[campos.temperatura])
  });
  if (error) return { error };
  const fecha = new Date(feed.created_at);
  if (Number.isNaN(fecha.getTime())) return { error: "created_at inválido" };
  if (!Number.isInteger(feed.entry_id) || feed.entry_id < 1) return { error: "entry_id inválido" };
  return { lectura, entryId: feed.entry_id, fecha: fecha.toISOString().replace("T", " ").replace("Z", "") };
}

async function leerFeed(cfg, resultados) {
  let url = `${cfg.base}/channels/${encodeURIComponent(cfg.canal)}/feeds.json?results=${resultados}`;
  if (cfg.readKey) url += `&api_key=${encodeURIComponent(cfg.readKey)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (r.status === 400 || r.status === 404) throw new Error("Canal no encontrado o THINGSPEAK_READ_KEY incorrecta.");
  if (!r.ok) throw new Error(`ThingSpeak respondió ${r.status}.`);
  const json = await r.json();
  if (json === -1 || !json || !Array.isArray(json.feeds)) {
    throw new Error("El canal es privado: falta THINGSPEAK_READ_KEY o es incorrecta.");
  }
  return json.feeds;
}

// Última entrada que copió el puente. Las que el ESP32 mandó directo (origen api) no cuentan:
// así, si una lectura no llegó a la API, el puente todavía la copia.
async function ultimoEntry(pool, canal) {
  const filas = await pool.query("SELECT COALESCE(MAX(ts_entry_id), 0) AS ultimo FROM lecturas WHERE ts_canal = ? AND origen = 'thingspeak'", [canal]);
  return Number(filas[0].ultimo);
}

// Una pasada del puente. Devuelve cuántas lecturas copió y cuántas descartó.
async function sincronizar(pool, cfg, log = () => {}) {
  const ultimo = await ultimoEntry(pool, cfg.canal);
  let feeds = await leerFeed(cfg, 100);
  // Primera vez o hueco (la laptop estuvo apagada): pedir todo el historial disponible.
  if (feeds.length && feeds[0].entry_id > ultimo + 1) feeds = await leerFeed(cfg, MAX_THINGSPEAK);

  // Las que ya están (copiadas antes o mandadas directo por el ESP32 con su ts_entry_id) se saltan.
  const ids = feeds.map((f) => f.entry_id).filter(Number.isInteger);
  const yaEstan = new Set();
  if (ids.length) {
    const filas = await pool.query(
      "SELECT ts_entry_id FROM lecturas WHERE ts_canal = ? AND ts_entry_id BETWEEN ? AND ?",
      [cfg.canal, Math.min(...ids), Math.max(...ids)]
    );
    filas.forEach((f) => yaEstan.add(Number(f.ts_entry_id)));
  }
  const nuevos = feeds.filter((f) => f.entry_id > ultimo && !yaEstan.has(f.entry_id));
  if (!nuevos.length) return { copiadas: 0, descartadas: 0, ultimo };

  await pool.query(
    "INSERT INTO dispositivos (id, descripcion, simulado) VALUES (?, ?, 0) " +
    "ON DUPLICATE KEY UPDATE descripcion = descripcion",
    [cfg.dispositivo, `ThingSpeak canal ${cfg.canal}`]
  );

  let copiadas = 0, descartadas = 0, mayor = ultimo;
  for (const feed of nuevos) {
    const fila = feedALectura(feed, cfg.campos);
    if (fila.error) {
      descartadas++;
      log(`  entry_id ${feed.entry_id} descartado: ${fila.error}`);
      continue;
    }
    const l = fila.lectura;
    const r = await pool.query(
      "INSERT IGNORE INTO lecturas (fecha, dispositivo, origen, ts_canal, ts_entry_id, ph, turbidez, conductividad, temperatura) " +
      "VALUES (?, ?, 'thingspeak', ?, ?, ?, ?, ?, ?)",
      [fila.fecha, l.dispositivo, cfg.canal, fila.entryId, l.ph, l.turbidez, l.conductividad, l.temperatura]
    );
    copiadas += Number(r.affectedRows);
    mayor = Math.max(mayor, fila.entryId);
  }
  if (copiadas) {
    await pool.query(
      "UPDATE dispositivos SET ultima_conexion = (SELECT MAX(fecha) FROM lecturas WHERE dispositivo = ?) WHERE id = ?",
      [cfg.dispositivo, cfg.dispositivo]
    );
  }
  return { copiadas, descartadas, ultimo: mayor };
}

function configDesdeEntorno(env = process.env) {
  return {
    base: (env.THINGSPEAK_URL || "https://api.thingspeak.com").replace(/\/$/, ""),
    canal: env.THINGSPEAK_CHANNEL_ID || "",
    readKey: env.THINGSPEAK_READ_KEY || "",
    dispositivo: DISPOSITIVO,   // lo copiado de ThingSpeak va al mismo esp32-1
    intervalo: Math.max(15, Number(env.PUENTE_INTERVALO || 60)),
    campos: {
      ph: env.TS_CAMPO_PH || "field1",
      turbidez: env.TS_CAMPO_TURBIDEZ || "field2",
      conductividad: env.TS_CAMPO_CONDUCTIVIDAD || "field3",
      temperatura: env.TS_CAMPO_TEMPERATURA || "field4"
    }
  };
}

async function principal() {
  const mariadb = require("mariadb");
  const { migrar } = require("./migrar");
  const cfg = configDesdeEntorno();
  if (!/^\d+$/.test(cfg.canal)) {
    console.error("Falta THINGSPEAK_CHANNEL_ID (número del canal) en el .env.");
    process.exit(1);
  }
  const pool = mariadb.createPool({
    host: process.env.DB_HOST || "db",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 2,
    dateStrings: true, decimalAsNumber: true, insertIdAsNumber: true, bigIntAsNumber: true
  });

  for (let intento = 1; ; intento++) {
    try { await migrar(pool); break; } catch (e) {
      if (/permisos de administrador|Falló la migración/.test(e.message) || intento === 15) { console.error(e.message); process.exit(1); }
      console.log(`Esperando a MariaDB (intento ${intento}/15): ${e.code || e.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.log(`Puente ThingSpeak → MariaDB · canal ${cfg.canal} · dispositivo ${cfg.dispositivo} · cada ${cfg.intervalo} s`);
  const pasada = async () => {
    try {
      const r = await sincronizar(pool, cfg, console.log);
      if (r.copiadas || r.descartadas) {
        console.log(`[${new Date().toISOString()}] ${r.copiadas} lectura(s) copiadas` +
          (r.descartadas ? `, ${r.descartadas} descartada(s)` : "") + ` · último entry_id ${r.ultimo}`);
      }
    } catch (e) {
      console.log(`[${new Date().toISOString()}] No se pudo sincronizar: ${e.cause ? e.cause.code || e.cause.message : e.message}`);
    }
  };
  await pasada();
  const t = setInterval(pasada, cfg.intervalo * 1000);
  const salir = () => { clearInterval(t); pool.end().then(() => process.exit(0)); };
  process.on("SIGTERM", salir);
  process.on("SIGINT", salir);
}

if (require.main === module) principal();

module.exports = { sincronizar, feedALectura, configDesdeEntorno, leerFeed };
