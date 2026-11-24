// Pruebas de la lógica del semáforo. Ejecutar: node --test tests/*.test.js
// Regla: verde 4 de 4 en rango · amarillo 3 o 2 de 4 · rojo 1 o 0 de 4 · gris si falta una lectura.
const test = require("node:test");
const assert = require("node:assert");
const S = require("../docs/js/semaforo.js");

const limpia = { ph: 7.2, turbidez: 1.5, conductividad: 600, temperatura: 22 };

test("son 4 parámetros, temperatura incluida", () => {
  assert.deepStrictEqual(S.CLAVES, ["ph", "turbidez", "conductividad", "temperatura"]);
  assert.strictEqual(S.VARIABLES.temperatura.unidad, "°C");
  assert.ok(S.UMBRALES_DEFECTO.temperatura.max > S.UMBRALES_DEFECTO.temperatura.min);
});

test("verde: los 4 en rango", () => {
  const r = S.clasificar(limpia);
  assert.strictEqual(r.estado, "verde");
  assert.strictEqual(r.enRango, 4);
});

test("amarillo: 3 de 4 en rango (1 fuera)", () => {
  assert.strictEqual(S.clasificar({ ...limpia, turbidez: 6 }).estado, "amarillo");
  assert.strictEqual(S.clasificar({ ...limpia, ph: 6.2 }).estado, "amarillo");
  assert.strictEqual(S.clasificar({ ...limpia, conductividad: 1800 }).estado, "amarillo");
  assert.strictEqual(S.clasificar({ ...limpia, temperatura: 33 }).estado, "amarillo");
});

test("amarillo: 2 de 4 en rango (2 fuera)", () => {
  const r = S.clasificar({ ...limpia, ph: 9.1, temperatura: 8 });
  assert.strictEqual(r.enRango, 2);
  assert.strictEqual(r.estado, "amarillo");
});

test("rojo: 1 de 4 en rango (3 fuera)", () => {
  const r = S.clasificar({ ph: 9.1, turbidez: 8, conductividad: 2000, temperatura: 22 });
  assert.strictEqual(r.enRango, 1);
  assert.strictEqual(r.estado, "rojo");
});

test("rojo: 0 de 4 en rango", () => {
  const r = S.clasificar({ ph: 5, turbidez: 80, conductividad: 4000, temperatura: 40 });
  assert.strictEqual(r.enRango, 0);
  assert.strictEqual(r.estado, "rojo");
});

test("límites exactos cuentan como dentro de rango", () => {
  assert.strictEqual(S.clasificar({ ph: 6.5, turbidez: 4, conductividad: 1500, temperatura: 30 }).estado, "verde");
  assert.strictEqual(S.clasificar({ ph: 8.5, turbidez: 0, conductividad: 50, temperatura: 10 }).estado, "verde");
});

test("conductividad muy baja (sonda fuera del agua) cuenta como fuera", () => {
  assert.strictEqual(S.clasificar({ ...limpia, conductividad: 5 }).estado, "amarillo");
});

test("gris: falta una lectura, también la temperatura", () => {
  assert.strictEqual(S.clasificar({ ...limpia, turbidez: null }).estado, "gris");
  assert.strictEqual(S.clasificar({ ...limpia, temperatura: null }).estado, "gris");
  assert.deepStrictEqual(S.clasificar({ ph: 7, conductividad: 600 }).faltantes, ["turbidez", "temperatura"]);
  assert.strictEqual(S.clasificar(null).estado, "gris");
});

test("crítico solo pone rojo si la opción está activa", () => {
  const extrema = { ...limpia, ph: 3.5 };
  assert.strictEqual(S.clasificar(extrema).estado, "amarillo");
  assert.strictEqual(S.clasificar(extrema, S.UMBRALES_DEFECTO, { criticoRojo: true }).estado, "rojo");
  const caliente = { ...limpia, temperatura: 38 };
  assert.strictEqual(S.clasificar(caliente, S.UMBRALES_DEFECTO, { criticoRojo: true }).estado, "rojo");
});

test("lectura vencida", () => {
  const ahora = new Date("2026-11-20T12:00:00Z");
  assert.strictEqual(S.estaVencida(new Date("2026-11-20T11:58:00Z"), ahora, 3), false);
  assert.strictEqual(S.estaVencida(new Date("2026-11-20T11:50:00Z"), ahora, 3), true);
});
