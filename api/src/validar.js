// Validación de lo que manda el ESP32. Sin dependencias, para poder probarla sola.

// Rangos físicos posibles de cada sensor: lo que caiga fuera es un error de lectura,
// no agua "mala". (Los umbrales de calidad del semáforo viven en la página.)
const LIMITES_FISICOS = {
  ph: [0, 14],
  turbidez: [0, 100],       // % (0 = agua limpia)
  conductividad: [0, 20000],
  temperatura: [-10, 100]
};

// Un solo dispositivo: el ESP32 del equipo. Lo que llega directo y lo que copia el puente
// desde ThingSpeak se guarda con este mismo nombre.
const DISPOSITIVO = "esp32-1";

// Datos de diagnóstico opcionales (no cuentan como lectura de calidad).
const LIMITES_DIAGNOSTICO = {
  rssi: [-120, 0],          // dBm
  ph_v: [0, 5],             // voltaje del módulo de pH
  turbidez_v: [0, 5],       // voltaje del sensor de turbidez
  conductividad_v: [0, 5]   // voltaje del módulo TDS
};

const RE_ID = /^[A-Za-z0-9_-]{1,32}$/;
const RE_FIRMWARE = /^[A-Za-z0-9_.-]{1,32}$/;

function revisarNumero(cuerpo, campo, [min, max], tipo) {
  const v = cuerpo[campo];
  if (v === undefined || v === null) return { valor: null };
  if (typeof v !== "number" || !Number.isFinite(v)) return { error: `${campo} debe ser un número o null.` };
  if (v < min || v > max) return { error: `${campo} = ${v} está fuera del rango ${tipo} (${min} a ${max}).` };
  return { valor: v };
}

function validarLectura(cuerpo) {
  if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) {
    return { error: "El cuerpo debe ser un objeto JSON." };
  }

  const lectura = {};
  let alguna = false;

  for (const [campo, rango] of Object.entries(LIMITES_FISICOS)) {
    const r = revisarNumero(cuerpo, campo, rango, "físico");
    if (r.error) return r;
    lectura[campo] = r.valor;
    if (r.valor !== null) alguna = true;
  }
  if (!alguna) return { error: "Manda al menos una variable (ph, turbidez, conductividad o temperatura)." };

  for (const [campo, rango] of Object.entries(LIMITES_DIAGNOSTICO)) {
    const r = revisarNumero(cuerpo, campo, rango, "posible");
    if (r.error) return r;
    lectura[campo] = r.valor;
  }
  if (lectura.rssi !== null) lectura.rssi = Math.round(lectura.rssi);

  if (cuerpo.dispositivo !== undefined && cuerpo.dispositivo !== DISPOSITIVO) {
    return { error: `Solo se acepta el dispositivo ${DISPOSITIVO} (el ESP32 del equipo).` };
  }
  lectura.dispositivo = DISPOSITIVO;

  // entry_id que ThingSpeak le dio a esta misma lectura: así el puente no la copia otra vez.
  const ts = cuerpo.ts_entry_id;
  if (ts !== undefined && ts !== null && (!Number.isInteger(ts) || ts < 1)) {
    return { error: "ts_entry_id debe ser un entero mayor que 0 o null." };
  }
  lectura.ts_entry_id = ts || null;

  if (cuerpo.firmware !== undefined && cuerpo.firmware !== null) {
    if (typeof cuerpo.firmware !== "string" || !RE_FIRMWARE.test(cuerpo.firmware)) {
      return { error: "firmware debe tener de 1 a 32 letras, números, punto, - o _." };
    }
  }
  lectura.firmware = cuerpo.firmware || null;

  if (cuerpo.simulado !== undefined && cuerpo.simulado !== false) {
    return { error: "Solo se aceptan lecturas del ESP32 real: el simulador se retiró." };
  }

  return { lectura };
}

function leerLimite(valor, porDefecto = 100, maximo = 1000) {
  const n = parseInt(valor, 10);
  if (!Number.isFinite(n)) return porDefecto;
  return Math.min(Math.max(n, 1), maximo);
}

function leerDispositivo(valor) {
  if (valor === undefined || valor === "") return null;
  return typeof valor === "string" && RE_ID.test(valor) ? valor : undefined;
}

module.exports = { validarLectura, leerLimite, leerDispositivo, LIMITES_FISICOS, LIMITES_DIAGNOSTICO, DISPOSITIVO };
