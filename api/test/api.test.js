// Pruebas de la API.
//   Unitarias (siempre):     npm test
//   Con MariaDB real:        TEST_DB_USER=... TEST_DB_PASSWORD=... TEST_DB_NAME=... npm test
//   + permisos mínimos:      además TEST_DB_APP_USER=... TEST_DB_APP_PASSWORD=... (usuario con SELECT, INSERT, UPDATE)
const test = require("node:test");
const assert = require("node:assert");
const { validarLectura, leerLimite, leerDispositivo } = require("../src/validar");
const { sentencias, listarMigraciones } = require("../src/migrar");

test("acepta una lectura completa y pone dispositivo por defecto", () => {
  const r = validarLectura({ ph: 7.1, turbidez: 1.2, conductividad: 640, temperatura: 22.5 });
  assert.ifError(r.error);
  assert.strictEqual(r.lectura.dispositivo, "esp32-1");
  assert.strictEqual(r.lectura.simulado, false);
  assert.strictEqual(r.lectura.rssi, null);
});

test("acepta null en un sensor que falló", () => {
  const r = validarLectura({ ph: 7.1, turbidez: null, conductividad: 640 });
  assert.ifError(r.error);
  assert.strictEqual(r.lectura.turbidez, null);
  assert.strictEqual(r.lectura.temperatura, null);
});

test("acepta diagnóstico: rssi, voltajes crudos, firmware, simulado", () => {
  const r = validarLectura({ ph: 7, rssi: -61.4, ph_v: 2.51, turbidez_v: 4.18, conductividad_v: 0.62, firmware: "v1.2.0", simulado: true });
  assert.ifError(r.error);
  assert.strictEqual(r.lectura.rssi, -61);
  assert.strictEqual(r.lectura.firmware, "v1.2.0");
  assert.strictEqual(r.lectura.simulado, true);
});

test("rechaza texto, valores imposibles y cuerpos vacíos", () => {
  assert.ok(validarLectura({ ph: "7" }).error);
  assert.ok(validarLectura({ ph: 15 }).error);
  assert.ok(validarLectura({ conductividad: -3 }).error);
  assert.ok(validarLectura({}).error);
  assert.ok(validarLectura({ rssi: -50 }).error, "solo diagnóstico no cuenta como lectura");
  assert.ok(validarLectura([]).error);
  assert.ok(validarLectura({ ph: 7, dispositivo: "x; DROP TABLE" }).error);
  assert.ok(validarLectura({ ph: 7, rssi: 12 }).error);
  assert.ok(validarLectura({ ph: 7, ph_v: 7 }).error);
  assert.ok(validarLectura({ ph: 7, simulado: "si" }).error);
  assert.ok(validarLectura({ ph: 7, firmware: "v1 beta" }).error);
});

test("limit y dispositivo de la consulta", () => {
  assert.strictEqual(leerLimite(undefined), 100);
  assert.strictEqual(leerLimite("0"), 1);
  assert.strictEqual(leerLimite("99999"), 1000);
  assert.strictEqual(leerDispositivo(undefined), null);
  assert.strictEqual(leerDispositivo("esp32-sim"), "esp32-sim");
  assert.strictEqual(leerDispositivo("a b"), undefined);
});

test("migraciones: orden y separación de sentencias", () => {
  const archivos = listarMigraciones();
  assert.deepStrictEqual(archivos.slice(0, 2), ["001_lecturas.sql", "002_dispositivos_y_diagnostico.sql"]);
  assert.deepStrictEqual(sentencias("-- comentario\nSELECT 1;\nSELECT 'a;b' ;\n"), ["SELECT 1", "SELECT 'a;b'"]);
});

const conDB = process.env.TEST_DB_NAME ? test : test.skip;

function crearPool(usuario, clave) {
  const mariadb = require("mariadb");
  return mariadb.createPool({
    host: process.env.TEST_DB_HOST || "127.0.0.1",
    user: usuario,
    password: clave,
    database: process.env.TEST_DB_NAME,
    dateStrings: true, decimalAsNumber: true, insertIdAsNumber: true, bigIntAsNumber: true
  });
}

conDB("integración con MariaDB: migraciones, POST, GET, dispositivos y salud", async () => {
  const { crearApp } = require("../src/app");
  const { migrar } = require("../src/migrar");
  const pool = crearPool(process.env.TEST_DB_USER, process.env.TEST_DB_PASSWORD);
  await migrar(pool, { log: () => {} });
  assert.deepStrictEqual(await migrar(pool, { log: () => {} }), [], "segunda vez no hay pendientes");
  await pool.query("DELETE FROM lecturas");
  await pool.query("DELETE FROM dispositivos WHERE id NOT IN ('esp32-1','esp32-sim')");

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

    const r1 = await post({ ph: 7.25, turbidez: 1.4, conductividad: 655.5, temperatura: 22.1, rssi: -58, ph_v: 2.512, firmware: "v1.0.0" });
    assert.strictEqual(r1.status, 201);
    assert.ok((await r1.json()).id > 0);
    assert.strictEqual((await post({ ph: 8.9, turbidez: null, conductividad: 700, dispositivo: "esp32-sim", simulado: true })).status, 201);
    assert.strictEqual((await post({ ph: 7.0, dispositivo: "nuevo-01", simulado: true })).status, 201, "dispositivo nuevo se registra solo");

    const g = await (await fetch(base + "/api/lecturas?limit=10")).json();
    assert.strictEqual(g.lecturas.length, 3);
    assert.strictEqual(g.lecturas[0].ph, 7.25);
    assert.strictEqual(g.lecturas[0].conductividad, 655.5);
    assert.strictEqual(g.lecturas[0].rssi, -58);
    assert.strictEqual(g.lecturas[1].turbidez, null);
    assert.match(g.lecturas[0].fecha, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.ok(Math.abs(new Date(g.lecturas[1].fecha) - Date.now()) < 60000, "la fecha debe estar en UTC");

    const soloSim = await (await fetch(base + "/api/lecturas?dispositivo=esp32-sim")).json();
    assert.strictEqual(soloSim.lecturas.length, 1);
    assert.strictEqual((await fetch(base + "/api/lecturas?dispositivo=a%20b")).status, 400);

    const d = await (await fetch(base + "/api/dispositivos")).json();
    const real = d.dispositivos.find((x) => x.id === "esp32-1");
    const nuevo = d.dispositivos.find((x) => x.id === "nuevo-01");
    assert.strictEqual(real.firmware, "v1.0.0");
    assert.strictEqual(real.lecturas, 1);
    assert.strictEqual(nuevo.simulado, true);
    assert.ok(real.segundos_sin_datos < 60);

    const s = await (await fetch(base + "/api/salud")).json();
    assert.strictEqual(s.ok, true);
    assert.strictEqual(s.lecturas, 3);

    const v = await pool.query("SELECT dispositivo, lecturas FROM resumen_diario ORDER BY dispositivo");
    assert.strictEqual(v.length, 3);
  } finally {
    await pool.query("DELETE FROM lecturas");
    await pool.query("DELETE FROM dispositivos WHERE id NOT IN ('esp32-1','esp32-sim')");
    servidor.close();
    await pool.end();
  }
});

const conUsuarioApp = process.env.TEST_DB_APP_USER ? test : test.skip;

conUsuarioApp("permisos mínimos: la API funciona sin poder crear tablas", async () => {
  const { crearApp } = require("../src/app");
  const { migrar } = require("../src/migrar");
  const pool = crearPool(process.env.TEST_DB_APP_USER, process.env.TEST_DB_APP_PASSWORD);
  try {
    assert.deepStrictEqual(await migrar(pool, { log: () => {} }), [], "con todo migrado no intenta nada");
    await assert.rejects(pool.query("CREATE TABLE intruso (x INT)"), /denied/i);
    await assert.rejects(pool.query("DELETE FROM lecturas"), /denied/i);

    const servidor = crearApp(pool, "llave-de-prueba-1234567890").listen(0);
    const base = `http://127.0.0.1:${servidor.address().port}`;
    const r = await fetch(base + "/api/lecturas", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": "llave-de-prueba-1234567890" },
      body: JSON.stringify({ ph: 7.1, dispositivo: "esp32-sim", simulado: true })
    });
    assert.strictEqual(r.status, 201);
    servidor.close();
  } finally {
    await pool.end();
  }
});

conUsuarioApp("permisos mínimos: si falta una migración, el error lo dice claro", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const { migrar } = require("../src/migrar");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-"));
  fs.writeFileSync(path.join(dir, "999_prueba.sql"), "CREATE TABLE prueba_999 (x INT);");
  const pool = crearPool(process.env.TEST_DB_APP_USER, process.env.TEST_DB_APP_PASSWORD);
  try {
    await assert.rejects(migrar(pool, { dir, log: () => {} }), /permisos de administrador/);
  } finally {
    await pool.end();
  }
});
