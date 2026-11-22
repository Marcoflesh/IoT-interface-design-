// Validación de lo que manda el ESP32. Sin dependencias, para poder probarla sola.

// Rangos físicos posibles de cada sensor: lo que caiga fuera es un error de lectura,
// no agua "mala". (Los umbrales de calidad del semáforo viven en la página.)
const LIMITES_FISICOS = {
  ph: [0, 14],
  turbidez: [0, 4000],
  conductividad: [0, 20000],
  temperatura: [-10, 100]
};

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

  const dispositivo = cuerpo.dispositivo === undefined ? "esp32-1" : cuerpo.dispositivo;
  if (typeof dispositivo !== "string" || !RE_ID.test(dispositivo)) {
    return { error: "dispositivo debe tener de 1 a 32 letras, números, - o _." };
  }
  lectura.dispositivo = dispositivo;

  if (cuerpo.firmware !== undefined && cuerpo.firmware !== null) {
    if (typeof cuerpo.firmware !== "string" || !RE_FIRMWARE.test(cuerpo.firmware)) {
      return { error: "firmware debe tener de 1 a 32 letras, números, punto, - o _." };
    }
  }
  lectura.firmware = cuerpo.firmware || null;

  if (cuerpo.simulado !== undefined && typeof cuerpo.simulado !== "boolean") {
    return { error: "simulado debe ser true o false." };
  }
  lectura.simulado = cuerpo.simulado === true;

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

module.exports = { validarLectura, leerLimite, leerDispositivo, LIMITES_FISICOS, LIMITES_DIAGNOSTICO };
