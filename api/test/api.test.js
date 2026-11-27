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
  assert.strictEqual(r.lectura.rssi, null);
});

test("acepta null en un sensor que falló", () => {
  const r = validarLectura({ ph: 7.1, turbidez: null, conductividad: 640 });
  assert.ifError(r.error);
  assert.strictEqual(r.lectura.turbidez, null);
  assert.strictEqual(r.lectura.temperatura, null);
});

test("acepta diagnóstico: rssi, voltajes crudos y firmware", () => {
  const r = validarLectura({ ph: 7, rssi: -61.4, ph_v: 2.51, turbidez_v: 4.18, conductividad_v: 0.62, firmware: "v1.2.0" });
  assert.ifError(r.error);
  assert.strictEqual(r.lectura.rssi, -61);
  assert.strictEqual(r.lectura.firmware, "v1.2.0");
});

test("turbidez en %: de 0 a 100", () => {
  assert.ifError(validarLectura({ turbidez: 0 }).error);
  assert.ifError(validarLectura({ turbidez: 100 }).error);
  assert.ok(validarLectura({ turbidez: 100.5 }).error, "más de 100 % no existe");
  assert.ok(validarLectura({ turbidez: -1 }).error);
});

test("solo acepta el dispositivo esp32-1", () => {
  assert.strictEqual(validarLectura({ ph: 7, dispositivo: "esp32-1" }).lectura.dispositivo, "esp32-1");
  for (const otro of ["esp32-sim", "esp32-sim-ts", "esp-32-sim", "prueba-terminal", "esp32-1-ts", "esp32-2"]) {
    assert.ok(validarLectura({ ph: 7, dispositivo: otro }).error, otro);
  }
  assert.ok(validarLectura({ ph: 7, simulado: true }).error);
  assert.ifError(validarLectura({ ph: 7, simulado: false }).error);
});

test("distancia ya no se guarda; temperatura sí", () => {
  const r = validarLectura({ temperatura: 22.5, conductividad: 410.2, distancia: 37.4, ph: null, turbidez: null });
  assert.ifError(r.error);
  assert.strictEqual(r.lectura.temperatura, 22.5);
  assert.strictEqual(r.lectura.distancia, undefined);
  assert.ok(validarLectura({ distancia: 50 }).error, "solo distancia ya no cuenta como lectura");
  assert.ifError(validarLectura({ temperatura: 21.8 }).error, "solo temperatura sí cuenta");
});

test("ts_entry_id: entero positivo o null", () => {
  assert.strictEqual(validarLectura({ ph: 7, ts_entry_id: 57 }).lectura.ts_entry_id, 57);
  assert.strictEqual(validarLectura({ ph: 7 }).lectura.ts_entry_id, null);
  assert.strictEqual(validarLectura({ ph: 7, ts_entry_id: null }).lectura.ts_entry_id, null);
  assert.ok(validarLectura({ ph: 7, ts_entry_id: 0 }).error, "0 = ThingSpeak la rechazó: no se manda");
  assert.ok(validarLectura({ ph: 7, ts_entry_id: "57" }).error);
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
  await pool.query("DELETE FROM dispositivos WHERE id NOT IN ('esp32-1')");

  const KEY = "llave-de-prueba-1234567890";
  const servidor = crearApp(pool, KEY, "123").listen(0);
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
    assert.strictEqual((await post({})).status, 400, "cuerpo vacío con llave buena = 400 (así prueba la llave prueba_red.ino)");

    const r1 = await post({ ph: 7.25, turbidez: 1.4, conductividad: 655.5, temperatura: 22.1, distancia: 37.4, rssi: -58, ph_v: 2.512, firmware: "v1.0.0" });
    assert.strictEqual(r1.status, 201);
    assert.ok((await r1.json()).id > 0);
    assert.strictEqual((await post({ ph: 8.9, turbidez: null, conductividad: 700, temperatura: 21.4, dispositivo: "esp32-1" })).status, 201);
    assert.strictEqual((await post({ ph: 7.0, dispositivo: "prueba-terminal" })).status, 400, "otro dispositivo no entra");
    assert.strictEqual((await post({ ph: 7, dispositivo: "esp32-sim" })).status, 400, "el simulador no entra");

    const g = await (await fetch(base + "/api/lecturas?limit=10")).json();
    assert.strictEqual(g.lecturas.length, 2);
    assert.strictEqual(g.lecturas[0].ph, 7.25);
    assert.strictEqual(g.lecturas[0].conductividad, 655.5);
    assert.strictEqual(g.lecturas[0].temperatura, 22.1);
    assert.strictEqual(g.lecturas[1].temperatura, 21.4);
    assert.strictEqual(g.lecturas[0].rssi, -58);
    assert.ok(!("distancia" in g.lecturas[0]), "la distancia ya no existe");
    assert.strictEqual(g.lecturas[1].turbidez, null);
    assert.match(g.lecturas[0].fecha, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.ok(Math.abs(new Date(g.lecturas[1].fecha) - Date.now()) < 60000, "la fecha debe estar en UTC");
    assert.strictEqual((await fetch(base + "/api/lecturas?dispositivo=a%20b")).status, 400);

    const d = await (await fetch(base + "/api/dispositivos")).json();
    assert.deepStrictEqual(d.dispositivos.map((x) => x.id), ["esp32-1"]);
    assert.strictEqual(d.dispositivos[0].firmware, "v1.0.0");
    assert.strictEqual(d.dispositivos[0].lecturas, 2);
    assert.ok(d.dispositivos[0].segundos_sin_datos < 60);

    const s = await (await fetch(base + "/api/salud")).json();
    assert.strictEqual(s.ok, true);
    assert.strictEqual(s.lecturas, 2);

    const v = await pool.query("SELECT dispositivo, lecturas FROM resumen_diario ORDER BY dispositivo");
    assert.deepStrictEqual(v.map((f) => f.dispositivo), ["esp32-1"]);
  } finally {
    await pool.query("DELETE FROM lecturas");
    await pool.query("DELETE FROM dispositivos WHERE id NOT IN ('esp32-1')");
    servidor.close();
    await pool.end();
  }
});

conDB("ESP32 directo + puente de ThingSpeak: una sola fila por lectura en esp32-1", async () => {
  const { crearApp } = require("../src/app");
  const { migrar } = require("../src/migrar");
  const { sincronizar, configDesdeEntorno } = require("../src/puente-thingspeak");
  const http = require("node:http");
  const pool = crearPool(process.env.TEST_DB_USER, process.env.TEST_DB_PASSWORD);
  await migrar(pool, { log: () => {} });
  await pool.query("DELETE FROM lecturas");

  // ThingSpeak falso con 3 entradas: 10 y 11 también llegaron directo a la API; 12 solo a ThingSpeak.
  const feeds = [10, 11, 12].map((id, i) => ({
    entry_id: id, created_at: `2026-11-24T19:0${i}:00Z`, field1: null, field2: null, field3: "410", field4: "22.5"
  }));
  const ts = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ channel: { id: 123 }, feeds }));
  }).listen(0);
  const KEY = "llave-de-prueba-1234567890";
  const servidor = crearApp(pool, KEY, "123").listen(0);
  const post = (cuerpo) => fetch(`http://127.0.0.1:${servidor.address().port}/api/lecturas`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": KEY }, body: JSON.stringify(cuerpo)
  });
  const cfg = { ...configDesdeEntorno({ THINGSPEAK_CHANNEL_ID: "123" }), base: `http://127.0.0.1:${ts.address().port}` };

  try {
    // 10: primero la API y luego el puente. 11: el puente se adelantó y luego llega la API.
    assert.strictEqual((await post({ conductividad: 410, temperatura: 22.5, rssi: -60, ts_entry_id: 10 })).status, 201);
    await pool.query("INSERT INTO lecturas (fecha, dispositivo, origen, ts_canal, ts_entry_id, conductividad, temperatura) VALUES ('2026-11-24 19:01:00', 'esp32-1', 'thingspeak', 123, 11, 410, 22.5)");
    assert.strictEqual((await post({ conductividad: 410, temperatura: 22.5, rssi: -61, ts_entry_id: 11 })).status, 201, "si ya estaba, la completa");

    const r = await sincronizar(pool, cfg);
    assert.strictEqual(r.copiadas, 1, "solo copia la 12");
    assert.strictEqual((await sincronizar(pool, cfg)).copiadas, 0, "segunda pasada no copia nada");

    const filas = await pool.query("SELECT dispositivo, origen, ts_entry_id, rssi FROM lecturas ORDER BY ts_entry_id");
    assert.deepStrictEqual(filas.map((f) => [f.dispositivo, f.origen, f.ts_entry_id, f.rssi]), [
      ["esp32-1", "api", 10, -60],
      ["esp32-1", "thingspeak", 11, -61],
      ["esp32-1", "thingspeak", 12, null]
    ]);

    // Sin Channel ID configurado en la API, el ts_entry_id se ignora (no hay con qué enlazarlo).
    const sinCanal = crearApp(pool, KEY).listen(0);
    await fetch(`http://127.0.0.1:${sinCanal.address().port}/api/lecturas`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": KEY }, body: JSON.stringify({ ph: 7, ts_entry_id: 99 })
    });
    sinCanal.close();
    const sueltas = await pool.query("SELECT ts_canal, ts_entry_id FROM lecturas WHERE ph = 7");
    assert.deepStrictEqual([sueltas[0].ts_canal, sueltas[0].ts_entry_id], [null, null]);
  } finally {
    await pool.query("DELETE FROM lecturas");
    servidor.close();
    ts.close();
    await pool.end();
  }
});

conDB("migración 006: deja solo esp32-1, junta lo de ThingSpeak y quita distancia", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { migrar } = require("../src/migrar");
  const pool = crearPool(process.env.TEST_DB_USER, process.env.TEST_DB_PASSWORD);
  try {
    await migrar(pool, { log: () => {} });
    await pool.query("DELETE FROM lecturas");
    await pool.query("DELETE FROM calibraciones");
    await pool.query("DELETE FROM dispositivos WHERE id <> 'esp32-1'");
    await pool.query("ALTER TABLE lecturas ADD COLUMN IF NOT EXISTS distancia DECIMAL(6,1) NULL");
    await pool.query("INSERT INTO dispositivos (id, descripcion, simulado) VALUES ('esp32-sim', 's', 1), ('esp-32-sim', 's', 0), ('prueba-terminal', 'p', 0), ('esp32-1-ts', 'ts', 0)");
    await pool.query("INSERT INTO lecturas (fecha, dispositivo, ph) VALUES (NOW(3), 'esp32-1', 7.1), (NOW(3), 'esp32-1-ts', 7.2), (NOW(3), 'esp32-sim', 8.1), (NOW(3), 'esp-32-sim', 8.2), (NOW(3), 'prueba-terminal', 8.3)");
    await pool.query("INSERT INTO calibraciones (dispositivo, sensor, fecha) VALUES ('prueba-terminal', 'ph', NOW()), ('esp32-1', 'ph', NOW())");

    const sql = fs.readFileSync(path.join(__dirname, "..", "migraciones", "006_solo_esp32_1.sql"), "utf8");
    for (const s of sentencias(sql)) await pool.query(s);
    for (const s of sentencias(sql)) await pool.query(s);   // dos veces: no debe fallar

    const lect = await pool.query("SELECT dispositivo, ph FROM lecturas ORDER BY ph");
    assert.deepStrictEqual(lect.map((f) => [f.dispositivo, f.ph]), [["esp32-1", 7.1], ["esp32-1", 7.2]]);
    assert.deepStrictEqual((await pool.query("SELECT id FROM dispositivos")).map((f) => f.id), ["esp32-1"]);
    assert.deepStrictEqual((await pool.query("SELECT dispositivo FROM calibraciones")).map((f) => f.dispositivo), ["esp32-1"]);
    const cols = (await pool.query("SHOW COLUMNS FROM lecturas")).map((f) => f.Field);
    assert.ok(!cols.includes("distancia"));
    assert.ok(cols.includes("temperatura"));
  } finally {
    await pool.query("DELETE FROM calibraciones");
    await pool.query("DELETE FROM lecturas");
    await pool.query("DELETE FROM dispositivos WHERE id <> 'esp32-1'");
    await pool.end();
  }
});

conDB("migración 004: borra el simulador y deja intacto el ESP32 real", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { migrar } = require("../src/migrar");
  const pool = crearPool(process.env.TEST_DB_USER, process.env.TEST_DB_PASSWORD);
  try {
    await migrar(pool, { log: () => {} });
    await pool.query("DELETE FROM lecturas");
    await pool.query("DELETE FROM calibraciones");
    await pool.query("DELETE FROM dispositivos WHERE id <> 'esp32-1'");
    await pool.query("INSERT INTO dispositivos (id, descripcion, simulado) VALUES ('esp32-sim', 'sim', 1), ('esp32-sim-ts', 'sim ts', 0), ('esp32-1-ts', 'real ts', 0)");
    await pool.query("INSERT INTO lecturas (fecha, dispositivo, ph) VALUES (NOW(3), 'esp32-1', 7.1), (NOW(3), 'esp32-1-ts', 7.2), (NOW(3), 'esp32-sim', 8.1), (NOW(3), 'esp32-sim', 8.2), (NOW(3), 'esp32-sim-ts', 8.3)");
    await pool.query("INSERT INTO calibraciones (dispositivo, sensor, fecha) VALUES ('esp32-sim', 'ph', NOW()), ('esp32-1', 'ph', NOW())");

    const sql = fs.readFileSync(path.join(__dirname, "..", "migraciones", "004_retirar_simulador.sql"), "utf8");
    for (const s of sentencias(sql)) await pool.query(s);

    const lect = await pool.query("SELECT dispositivo, COUNT(*) AS n FROM lecturas GROUP BY dispositivo ORDER BY dispositivo");
    assert.deepStrictEqual(lect.map((f) => [f.dispositivo, Number(f.n)]), [["esp32-1", 1], ["esp32-1-ts", 1]]);
    const disp = await pool.query("SELECT id FROM dispositivos ORDER BY id");
    assert.deepStrictEqual(disp.map((f) => f.id), ["esp32-1", "esp32-1-ts"]);
    const cal = await pool.query("SELECT dispositivo FROM calibraciones");
    assert.deepStrictEqual(cal.map((f) => f.dispositivo), ["esp32-1"]);
  } finally {
    await pool.query("DELETE FROM calibraciones");
    await pool.query("DELETE FROM lecturas");
    await pool.query("DELETE FROM dispositivos WHERE id <> 'esp32-1'");
    await pool.end();
  }
});

conDB("migración 007: turbidez en %, borra valores viejos en NTU mayores a 100", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { migrar } = require("../src/migrar");
  const pool = crearPool(process.env.TEST_DB_USER, process.env.TEST_DB_PASSWORD);
  try {
    await migrar(pool, { log: () => {} });
    await pool.query("DELETE FROM lecturas");
    await pool.query("ALTER TABLE lecturas MODIFY COLUMN turbidez DECIMAL(7,2) NULL");   // como estaba antes
    await pool.query("INSERT INTO lecturas (fecha, dispositivo, ph, turbidez, temperatura) VALUES (NOW(3), 'esp32-1', 7.1, 3.5, 22), (NOW(3), 'esp32-1', 7.2, 850, 23)");

    const sql = fs.readFileSync(path.join(__dirname, "..", "migraciones", "007_turbidez_porcentaje.sql"), "utf8");
    for (const s of sentencias(sql)) await pool.query(s);
    for (const s of sentencias(sql)) await pool.query(s);   // dos veces: no debe fallar

    const filas = await pool.query("SELECT ph, turbidez, temperatura FROM lecturas ORDER BY ph");
    assert.deepStrictEqual(filas.map((f) => [f.ph, f.turbidez, f.temperatura]), [[7.1, 3.5, 22], [7.2, null, 23]]);
    const col = await pool.query("SELECT COLUMN_TYPE, COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lecturas' AND COLUMN_NAME = 'turbidez'");
    assert.strictEqual(col[0].COLUMN_TYPE, "decimal(5,2)");
    assert.match(col[0].COLUMN_COMMENT, /%/);
  } finally {
    await pool.query("DELETE FROM lecturas");
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
      body: JSON.stringify({ ph: 7.1, ts_entry_id: 5 })
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
