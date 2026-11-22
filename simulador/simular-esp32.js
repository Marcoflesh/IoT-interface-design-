#!/usr/bin/env node
/*
 * simular-esp32.js
 * ESP32 virtual en la terminal: mide con el mismo modelo físico que el laboratorio
 * de la página y manda por HTTP a la API real (MariaDB) y, si das la llave, a ThingSpeak.
 * Sirve para probar toda la cadena mientras llega el hardware.
 *
 *   node simulador/simular-esp32.js                     (lee ESP32_API_KEY del .env)
 *   node simulador/simular-esp32.js --muestra tierra --guion
 *   node simulador/simular-esp32.js --ciclos 5 --intervalo 2   (prueba rápida)
 *
 * Variables de entorno (o .env en la raíz del repo):
 *   API_URL               http://127.0.0.1:8080/api/lecturas
 *   ESP32_API_KEY         la misma del .env de la API
 *   THINGSPEAK_WRITE_KEY  opcional: si existe, también manda a ThingSpeak (mín. 15 s)
 *   SIM_MUESTRA           llave | purificada | tierra | sal | vinagre | tierraVinagre | jabonosa
 *   SIM_GUION             1 = cambia de muestra cada SIM_GUION_MIN minutos (demo desatendida)
 *   SIM_DISPOSITIVO       esp32-sim
 *
 * Mientras corre, escribe comandos y Enter:  ayuda
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const Sim = require(path.join(__dirname, "..", "docs", "js", "esp32-virtual.js"));

// ---------- Configuración ----------

function leerEnvArchivo() {
  const archivo = path.join(__dirname, "..", ".env");
  const vars = {};
  if (!fs.existsSync(archivo)) return vars;
  for (const linea of fs.readFileSync(archivo, "utf8").split("\n")) {
    const m = linea.replace(/\r$/, "").match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    // Mismas reglas que Docker Compose: comillas, o comentario " # …" al final.
    const v = m[2].trim();
    const q = v.match(/^(["'])(.*?)\1/);
    vars[m[1]] = q ? q[2] : v.replace(/\s+#.*$/, "").trim();
  }
  return vars;
}
const archivoEnv = leerEnvArchivo();
const env = (k, def) => process.env[k] || archivoEnv[k] || def;

function arg(nombre, def) {
  const i = process.argv.indexOf("--" + nombre);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
}

const cfg = {
  apiUrl: env("API_URL", "http://127.0.0.1:8080/api/lecturas"),
  apiKey: env("ESP32_API_KEY", ""),
  tsKey: env("THINGSPEAK_WRITE_KEY", ""),
  muestra: arg("muestra", env("SIM_MUESTRA", "llave")),
  guion: arg("guion", env("SIM_GUION", "0")) === true || env("SIM_GUION", "0") === "1",
  guionMin: Number(env("SIM_GUION_MIN", "5")),
  dispositivo: env("SIM_DISPOSITIVO", "esp32-sim"),
  intervalo: Number(arg("intervalo", env("SIM_INTERVALO", "20"))),
  ciclos: Number(arg("ciclos", 0)),
  sinApi: arg("sin-api", false) === true
};

if (!Sim.MUESTRAS[cfg.muestra]) {
  console.error(`Muestra desconocida: ${cfg.muestra}. Opciones: ${Object.keys(Sim.MUESTRAS).join(", ")}`);
  process.exit(1);
}
if (!cfg.sinApi && cfg.apiKey.length < 16) {
  console.error("Falta ESP32_API_KEY (en .env o como variable de entorno). Usa --sin-api para solo ver el monitor serie.");
  process.exit(1);
}
if (cfg.tsKey && cfg.intervalo < 15) {
  console.error("Con ThingSpeak el intervalo mínimo es 15 s (plan gratuito).");
  process.exit(1);
}

// ---------- ESP32 virtual ----------

const esp = Sim.crear({
  semilla: Date.now() % 100000,
  intervaloSeg: cfg.intervalo,
  muestra: cfg.muestra,
  dispositivo: cfg.dispositivo,
  alLog: (linea) => console.log(linea)
});

const GUION = ["llave", "tierra", "llave", "vinagre", "tierraVinagre", "llave", "sal", "purificada", "jabonosa", "llave"];
let pasoGuion = Math.max(0, GUION.indexOf(cfg.muestra));
let ultimoCambioGuion = Date.now();
let enviados = 0;
let ocupado = false;

async function enviarAPI(lectura) {
  if (cfg.sinApi) return "omitido (--sin-api)";
  try {
    const r = await fetch(cfg.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": cfg.apiKey },
      body: JSON.stringify(Sim.cuerpoAPI(lectura)),
      signal: AbortSignal.timeout(5000)
    });
    return r.ok ? String(r.status) : `${r.status} ${await r.text()}`;
  } catch (e) {
    return `-1 (${e.cause ? e.cause.code || e.cause.message : e.message})`;
  }
}

async function enviarThingSpeak(l) {
  if (!cfg.tsKey) return `${esp.thingSpeakSimulado()} (simulado)`;
  const q = new URLSearchParams({ api_key: cfg.tsKey });
  if (l.ph !== null) q.set("field1", l.ph);
  if (l.turbidez !== null) q.set("field2", l.turbidez);
  if (l.conductividad !== null) q.set("field3", l.conductividad);
  if (l.temperatura !== null) q.set("field4", l.temperatura);
  try {
    const r = await fetch("https://api.thingspeak.com/update?" + q, { signal: AbortSignal.timeout(8000) });
    return r.ok ? (await r.text()).trim() : `HTTP ${r.status}`;
  } catch (e) {
    return "-1 (sin conexión a ThingSpeak)";
  }
}

async function tick() {
  if (ocupado) return;
  ocupado = true;
  try {
    if (cfg.guion && Date.now() - ultimoCambioGuion >= cfg.guionMin * 60000) {
      pasoGuion = (pasoGuion + 1) % GUION.length;
      esp.cambiarMuestra(GUION[pasoGuion]);
      ultimoCambioGuion = Date.now();
    }
    for (const r of esp.avanzar(0.25)) {
      if (!r.listoParaEnviar) continue;
      const [ts, api] = await Promise.all([enviarThingSpeak(r.lectura), enviarAPI(r.lectura)]);
      esp.log(`ThingSpeak entry_id: ${ts} · API HTTP: ${api}`);
      enviados++;
      if (cfg.ciclos && enviados >= cfg.ciclos) salir(0);
    }
  } finally {
    ocupado = false;
  }
}

// ---------- Comandos ----------

const AYUDA = `Comandos:
  muestras                         lista las muestras
  muestra <id>                     cambia el agua del vaso (ej. muestra tierra)
  falla <ph|turbidez|conductividad|temperatura|fueraDelAgua|sinCapacitor> <on|off>
  wifi <on|off>                    simula perder la red
  calibrar <ph|tds|turbidez>       calibración con buffers / solución / agua limpia
  fabrica                          borra la calibración
  reiniciar                        reinicio del ESP32
  estado                           valores reales vs. medidos
  salir`;

function comando(linea) {
  const [c, a, b] = linea.trim().split(/\s+/);
  if (!c) return;
  const on = (x) => x === "on" || x === "si" || x === "1";
  switch (c) {
    case "ayuda": case "help": console.log(AYUDA); break;
    case "muestras": for (const [id, m] of Object.entries(Sim.MUESTRAS)) console.log(`  ${id.padEnd(14)} ${m.nombre} · pH ${m.ph} · ${m.ntu} NTU · ${m.ec25} µS/cm`); break;
    case "muestra": if (Sim.MUESTRAS[a]) { esp.cambiarMuestra(a); cfg.guion = false; } else console.log("Muestra desconocida. Escribe: muestras"); break;
    case "falla": esp.falla(a, on(b)); break;
    case "wifi": esp.wifi(on(a)); break;
    case "calibrar": if (a === "ph") esp.calibrarPH(); else if (a === "tds") esp.calibrarTDS(); else if (a === "turbidez") esp.calibrarTurbidez(); else console.log("calibrar ph | tds | turbidez"); break;
    case "fabrica": esp.valoresFabrica(); break;
    case "reiniciar": esp.reiniciar(); break;
    case "estado": {
      const v = esp.verdad(), u = esp.ultimo();
      console.log(`  Vaso (real): pH ${v.ph === null ? "–" : v.ph.toFixed(2)} · ${v.turbidez.toFixed(1)} NTU · ${v.conductividad.toFixed(0)} µS/cm · ${v.temperatura.toFixed(2)} °C`);
      if (u) console.log(`  ESP32 mide: pH ${u.lectura.ph} · ${u.lectura.turbidez} NTU · ${u.lectura.conductividad} µS/cm · ${u.lectura.temperatura} °C`);
      console.log(`  Muestra: ${Sim.MUESTRAS[esp.muestra()].nombre} · WiFi ${esp.wifi().conectado ? "conectado " + esp.wifi().rssi + " dBm" : "sin conexión"} · próximo envío en ${esp.proximoEnvio().toFixed(0)} s`);
      break;
    }
    case "salir": case "exit": salir(0); break;
    default: console.log("No conozco ese comando. Escribe: ayuda");
  }
}

let intervaloTick;
function salir(codigo) {
  clearInterval(intervaloTick);
  console.log(`\nSimulador detenido. Lecturas enviadas: ${enviados}.`);
  process.exit(codigo);
}

console.log(`ESP32 virtual → API ${cfg.sinApi ? "(desactivada)" : cfg.apiUrl} · ThingSpeak ${cfg.tsKey ? "REAL" : "simulado"} · cada ${cfg.intervalo} s · ${cfg.guion ? "guion automático cada " + cfg.guionMin + " min" : "muestra fija"}`);
if (process.stdin.isTTY) console.log("Escribe 'ayuda' y Enter para ver comandos.\n");
intervaloTick = setInterval(tick, 250);
process.on("SIGINT", () => salir(0));
process.on("SIGTERM", () => salir(0));
if (process.stdin.isTTY || process.env.SIM_COMANDOS === "1") {
  readline.createInterface({ input: process.stdin }).on("line", comando);
}
