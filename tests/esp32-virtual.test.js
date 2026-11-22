// Pruebas del ESP32 virtual: que los modelos sean coherentes y que cada muestra
// dé el color de semáforo esperado. Ejecutar: node --test tests/*.test.js
const test = require("node:test");
const assert = require("node:assert");
const Sim = require("../docs/js/esp32-virtual.js");
const S = require("../docs/js/semaforo.js");
const { validarLectura } = require("../api/src/validar.js");

const M = Sim._modelos;

function estable(esp, segundos) {
  esp.avanzar(segundos, { silencioso: true });
  const r = [];
  for (let i = 0; i < 10; i++) r.push(...esp.avanzar(esp.intervalo, { silencioso: true }));
  return r;
}

test("curvas de sensores: ida y vuelta", () => {
  for (const ntu of [0, 1, 4, 20, 100, 1000]) {
    assert.ok(Math.abs(M.ntuDesdeVoltaje(M.voltajeDesdeNtu(ntu)) - ntu) < 1e-6, `NTU ${ntu}`);
  }
  for (const ec of [50, 600, 1500, 2000]) {
    assert.ok(Math.abs(M.ecDesdeVoltaje(M.voltajeDesdeEc(ec)) - ec) < 0.5, `EC ${ec}`);
  }
  assert.ok(M.voltajeDesdeNtu(0) > 4.19 && M.voltajeDesdeNtu(0) < 4.21, "agua limpia ≈ 4.2 V");
  assert.strictEqual(M.voltajeDesdeEc(5000), 2.3, "el módulo TDS se satura en 2.3 V");
});

test("cada muestra da el color esperado (ya asentada)", () => {
  const esperado = {
    purificada: "verde", llave: "verde", tierra: "amarillo", sal: "amarillo",
    vinagre: "amarillo", tierraVinagre: "rojo", jabonosa: "rojo"
  };
  for (const [id, color] of Object.entries(esperado)) {
    const esp = Sim.crear({ semilla: 7, muestra: id });
    const lecturas = estable(esp, 120).map((r) => r.lectura);
    const colores = lecturas.map((l) => S.clasificar(l).estado);
    const aciertos = colores.filter((c) => c === color).length;
    assert.ok(aciertos >= 9, `${id}: esperaba ${color}, salió ${colores.join(",")}`);
  }
});

test("sin calibrar: la turbidez no distingue agua turbia (sensibilidad del SEN0189)", () => {
  const esp = Sim.crear({ semilla: 13, muestra: "tierra", calibrado: false });
  const sinCal = estable(esp, 60).map((r) => r.lectura.turbidez);
  esp.calibrarTurbidez();
  esp.avanzar(5 * esp.intervalo, { silencioso: true });
  const conCal = estable(esp, 0).map((r) => r.lectura.turbidez);
  const prom = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(prom(sinCal) < 4, `sin calibrar marca ${prom(sinCal)} NTU`);
  assert.ok(Math.abs(prom(conCal) - esp.verdad().turbidez) < 3, `calibrado ${prom(conCal)} vs ${esp.verdad().turbidez}`);
});

test("error de medición realista, y menor después de calibrar", () => {
  const esp = Sim.crear({ semilla: 11, muestra: "llave", calibrado: false });
  const antes = estable(esp, 120).map((r) => r.lectura);
  const v = esp.verdad();
  const prom = (arr, k) => arr.reduce((a, l) => a + l[k], 0) / arr.length;
  const errPH = Math.abs(prom(antes, "ph") - v.ph);
  const errEC = Math.abs(prom(antes, "conductividad") - v.conductividad) / v.conductividad;
  assert.ok(errPH < 0.25, `pH sin calibrar: error ${errPH}`);
  assert.ok(errEC < 0.08, `EC sin calibrar: error ${errEC}`);
  assert.ok(Math.abs(prom(antes, "temperatura") - v.temperatura) < 0.4);

  const cal = esp.calibrarPH();
  esp.calibrarTDS();
  assert.ok(cal.eficiencia > 90 && cal.eficiencia < 100, `eficiencia ${cal.eficiencia}`);
  const despues = estable(esp, 10).map((r) => r.lectura);
  const v2 = esp.verdad();
  assert.ok(Math.abs(prom(despues, "ph") - v2.ph) < 0.06, "pH calibrado");
  assert.ok(Math.abs(prom(despues, "conductividad") - v2.conductividad) / v2.conductividad < 0.03, "EC calibrada");
});

test("agua limpia no parpadea a amarillo por ruido del ADC", () => {
  const esp = Sim.crear({ semilla: 3, muestra: "llave" });
  esp.avanzar(60, { silencioso: true });
  const r = esp.avanzar(200 * esp.intervalo, { silencioso: true });
  const verdes = r.filter((x) => S.clasificar(x.lectura).estado === "verde").length;
  assert.ok(verdes / r.length >= 0.98, `verde ${verdes}/${r.length}`);
});

test("fallas: sensor desconectado = null, sonda fuera del agua, WiFi caído", () => {
  const esp = Sim.crear({ semilla: 5, muestra: "llave" });
  esp.avanzar(60, { silencioso: true });

  esp.falla("ph", true);
  let r = esp.avanzar(esp.intervalo)[0];
  assert.strictEqual(r.lectura.ph, null);
  assert.strictEqual(S.clasificar(r.lectura).estado, "gris");
  esp.falla("ph", false);

  esp.falla("temperatura", true);
  r = esp.avanzar(esp.intervalo)[0];
  assert.strictEqual(r.lectura.temperatura, null);
  assert.ok(r.lectura.conductividad > 0, "sin temperatura compensa a 25 °C y sigue midiendo");
  esp.falla("temperatura", false);

  esp.falla("fueraDelAgua", true);
  r = estable(esp, 30).pop();
  assert.ok(r.lectura.conductividad < 50, "sonda seca: conductividad casi 0");
  esp.falla("fueraDelAgua", false);

  esp.wifi(false);
  r = esp.avanzar(esp.intervalo)[0];
  assert.strictEqual(r.listoParaEnviar, false);
  esp.wifi(true);
  esp.avanzar(5);
  assert.strictEqual(esp.wifi().conectado, true);
});

test("precarga de una hora con eventos para Alertas", () => {
  const esp = Sim.crear({ semilla: 502 });
  const ahora = Date.now();
  const l = Sim.precargar(esp, 60, null, ahora);
  assert.strictEqual(l.length, 180);
  for (let i = 1; i < l.length; i++) assert.ok(l[i].fecha > l[i - 1].fecha);
  assert.ok(ahora - l[l.length - 1].fecha.getTime() < 21000);
  const colores = new Set(l.map((x) => S.clasificar(x).estado));
  assert.ok(colores.has("verde") && colores.has("amarillo") && colores.has("rojo"), [...colores].join(","));
});

test("misma semilla, mismas lecturas", () => {
  const a = Sim.crear({ semilla: 42 }).avanzar(20, { silencioso: true })[0].lectura;
  const b = Sim.crear({ semilla: 42 }).avanzar(20, { silencioso: true })[0].lectura;
  assert.deepStrictEqual(a, b);
});

test("lo que manda el simulador lo acepta la API", () => {
  const esp = Sim.crear({ semilla: 9, muestra: "jabonosa" });
  const r = estable(esp, 60);
  for (const x of r) {
    const v = validarLectura(Sim.cuerpoAPI(x.lectura));
    assert.ifError(v.error);
    assert.strictEqual(v.lectura.simulado, true);
  }
});
