// Validación de lo que manda el ESP32. Sin dependencias, para poder probarla sola.

// Rangos físicos posibles de cada sensor: lo que caiga fuera es un error de lectura,
// no agua "mala". (Los umbrales de calidad del semáforo viven en la página.)
const LIMITES_FISICOS = {
  ph: [0, 14],
  turbidez: [0, 4000],
  conductividad: [0, 20000],
  temperatura: [-10, 100]
};

function validarLectura(cuerpo) {
  if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) {
    return { error: "El cuerpo debe ser un objeto JSON." };
  }

  const lectura = {};
  let alguna = false;

  for (const [campo, [min, max]] of Object.entries(LIMITES_FISICOS)) {
    const v = cuerpo[campo];
    if (v === undefined || v === null) {
      lectura[campo] = null;
      continue;
    }
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return { error: `${campo} debe ser un número o null.` };
    }
    if (v < min || v > max) {
      return { error: `${campo} = ${v} está fuera del rango físico (${min} a ${max}).` };
    }
    lectura[campo] = v;
    alguna = true;
  }

  if (!alguna) return { error: "Manda al menos una variable (ph, turbidez, conductividad o temperatura)." };

  const dispositivo = cuerpo.dispositivo === undefined ? "esp32-1" : cuerpo.dispositivo;
  if (typeof dispositivo !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(dispositivo)) {
    return { error: "dispositivo debe tener de 1 a 32 letras, números, - o _." };
  }
  lectura.dispositivo = dispositivo;

  return { lectura };
}

function leerLimite(valor, porDefecto = 100, maximo = 1000) {
  const n = parseInt(valor, 10);
  if (!Number.isFinite(n)) return porDefecto;
  return Math.min(Math.max(n, 1), maximo);
}

module.exports = { validarLectura, leerLimite, LIMITES_FISICOS };
