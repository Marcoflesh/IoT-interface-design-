// Pruebas de la API.
//   Unitarias (siempre):     npm test
//   Con MariaDB real:        TEST_DB_USER=... TEST_DB_PASSWORD=... TEST_DB_NAME=... npm test
const test = require("node:test");
const assert = require("node:assert");
const { validarLectura, leerLimite } = require("../src/validar");

test("acepta una lectura completa y pone dispositivo por defecto", () => {
  const r = validarLectura({ ph: 7.1, turbidez: 1.2, conductividad: 640, temperatura: 22.5 });
  assert.ifError(r.error);
  assert.strictEqual(r.lectura.dispositivo, "esp32-1");
});

test("acepta null en un sensor que falló", () => {
  const r = validarLectura({ ph: 7.1, turbidez: null, conductividad: 640 });
  assert.ifError(r.error);
  assert.strictEqual(r.lectura.turbidez, null);
  assert.strictEqual(r.lectura.temperatura, null);
});

test("rechaza texto, valores imposibles y cuerpos vacíos", () => {
  assert.ok(validarLectura({ ph: "7" }).error);
  assert.ok(validarLectura({ ph: 15 }).error);
  assert.ok(validarLectura({ conductividad: -3 }).error);
  assert.ok(validarLectura({}).error);
  assert.ok(validarLectura([]).error);
  assert.ok(validarLectura({ ph: 7, dispositivo: "x; DROP TABLE" }).error);
});

test("limit se acota entre 1 y 1000", () => {
  assert.strictEqual(leerLimite(undefined), 100);
  assert.strictEqual(leerLimite("0"), 1);
  assert.strictEqual(leerLimite("50"), 50);
  assert.strictEqual(leerLimite("99999"), 1000);
});

const conDB = process.env.TEST_DB_NAME ? test : test.skip;

conDB("integración con MariaDB: POST, GET y salud", async () => {
  const mariadb = require("mariadb");
  const { crearApp, asegurarEsquema } = require("../src/app");
  const pool = mariadb.createPool({
    host: process.env.TEST_DB_HOST || "127.0.0.1",
    user: process.env.TEST_DB_USER,
    password: process.env.TEST_DB_PASSWORD,
    database: process.env.TEST_DB_NAME,
    dateStrings: true, decimalAsNumber: true, insertIdAsNumber: true, bigIntAsNumber: true
  });
  await asegurarEsquema(pool);
  await asegurarEsquema(pool); // idempotente
  await pool.query("DELETE FROM lecturas");

  const KEY = "llave-de-prueba-1234567890";
  const servidor = crearApp(pool, KEY).listen(0);
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const post = (cuerpo, llave = KEY, crudo) => fetch(base + "/api/lecturas", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": llave },
    body: crudo || JSON.stringify(cuerpo)
  });

  try {
    assert.strictEqual((await post({ ph: 7 }, "otra-llave-incorrecta")).status, 401);
    assert.strictEqual((await post({ ph: 20 })).status, 400);
    assert.strictEqual((await post(null, KEY, '{"ph": nan}')).status, 400);

    const r1 = await post({ ph: 7.25, turbidez: 1.4, conductividad: 655.5, temperatura: 22.1 });
    assert.strictEqual(r1.status, 201);
    assert.ok((await r1.json()).id > 0);
    assert.strictEqual((await post({ ph: 8.9, turbidez: null, conductividad: 700 })).status, 201);

    const g = await (await fetch(base + "/api/lecturas?limit=10")).json();
    assert.strictEqual(g.canal, "MariaDB");
    assert.strictEqual(g.lecturas.length, 2);
    assert.strictEqual(g.lecturas[0].ph, 7.25);                 // orden cronológico
    assert.strictEqual(g.lecturas[0].conductividad, 655.5);     // DECIMAL llega como número
    assert.strictEqual(g.lecturas[1].turbidez, null);
    assert.match(g.lecturas[0].fecha, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.ok(Math.abs(new Date(g.lecturas[1].fecha) - Date.now()) < 60000, "la fecha debe estar en UTC");

    const s = await (await fetch(base + "/api/salud")).json();
    assert.strictEqual(s.ok, true);
    assert.strictEqual(s.lecturas, 2);

    const v = await pool.query("SELECT lecturas, ph_promedio FROM resumen_diario");
    assert.strictEqual(v[0].lecturas, 2);
  } finally {
    await pool.query("DELETE FROM lecturas");
    servidor.close();
    await pool.end();
  }
});
