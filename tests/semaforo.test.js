// Pruebas de la lógica del semáforo. Ejecutar: node --test tests/*.test.js
const test = require("node:test");
const assert = require("node:assert");
const S = require("../docs/js/semaforo.js");

const limpia = { ph: 7.2, turbidez: 1.5, conductividad: 600 };

test("verde: las 3 variables en rango", () => {
  assert.strictEqual(S.clasificar(limpia).estado, "verde");
});

test("amarillo: exactamente 1 fuera de rango", () => {
  assert.strictEqual(S.clasificar({ ...limpia, turbidez: 6 }).estado, "amarillo");
  assert.strictEqual(S.clasificar({ ...limpia, ph: 6.2 }).estado, "amarillo");
  assert.strictEqual(S.clasificar({ ...limpia, conductividad: 1800 }).estado, "amarillo");
});

test("rojo: 2 o 3 fuera de rango", () => {
  assert.strictEqual(S.clasificar({ ph: 9.1, turbidez: 8, conductividad: 600 }).estado, "rojo");
  assert.strictEqual(S.clasificar({ ph: 5, turbidez: 80, conductividad: 4000 }).estado, "rojo");
});

test("límites exactos cuentan como dentro de rango", () => {
  assert.strictEqual(S.clasificar({ ph: 6.5, turbidez: 4, conductividad: 1500 }).estado, "verde");
  assert.strictEqual(S.clasificar({ ph: 8.5, turbidez: 0, conductividad: 50 }).estado, "verde");
});

test("conductividad muy baja (sonda fuera del agua) cuenta como fuera", () => {
  assert.strictEqual(S.clasificar({ ...limpia, conductividad: 5 }).estado, "amarillo");
});

test("gris: falta una lectura", () => {
  assert.strictEqual(S.clasificar({ ph: 7, turbidez: null, conductividad: 600 }).estado, "gris");
  assert.strictEqual(S.clasificar(null).estado, "gris");
});

test("crítico solo pone rojo si la opción está activa", () => {
  const extrema = { ...limpia, ph: 3.5 };
  assert.strictEqual(S.clasificar(extrema).estado, "amarillo");
  assert.strictEqual(S.clasificar(extrema, S.UMBRALES_DEFECTO, { criticoRojo: true }).estado, "rojo");
});

test("lectura vencida", () => {
  const ahora = new Date("2026-11-20T12:00:00Z");
  assert.strictEqual(S.estaVencida(new Date("2026-11-20T11:58:00Z"), ahora, 3), false);
  assert.strictEqual(S.estaVencida(new Date("2026-11-20T11:50:00Z"), ahora, 3), true);
});
