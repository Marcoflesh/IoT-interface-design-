// Pruebas del puente ThingSpeak → MariaDB con un ThingSpeak falso (servidor HTTP local).
//   Unitarias: npm test · Con MariaDB: mismas variables TEST_DB_* que api.test.js
const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { feedALectura, configDesdeEntorno, sincronizar, leerFeed } = require("../src/puente-thingspeak");

const CAMPOS = configDesdeEntorno({}).campos;

function feed(id, minuto, campos = {}) {
  return {
    entry_id: id,
    created_at: new Date(Date.UTC(2026, 10, 21, 18, minuto, 0)).toISOString().replace(".000", ""),
    field1: "7.21", field2: "1.4", field3: "655.0", field4: "22.4", ...campos
  };
}

// ThingSpeak falso: devuelve las últimas `results` entradas, como el real.
function servidorFalso(estado) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const u = new URL(req.url, "http://x");
      estado.peticiones.push(u.search);
      if (estado.privado && u.searchParams.get("api_key") !== "LLAVE") {
        res.end("-1");
        return;
      }
      const n = Number(u.searchParams.get("results"));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ channel: { id: 123 }, feeds: estado.feeds.slice(-n) }));
    });
    s.listen(0, () => resolve(s));
  });
}

test("una entrada de ThingSpeak se convierte en fila", () => {
  const f = feedALectura(feed(7, 5), CAMPOS, "esp32-1-ts");
  assert.ifError(f.error);
  assert.strictEqual(f.entryId, 7);
  assert.strictEqual(f.fecha, "2026-11-21 18:05:00.000");
  assert.deepStrictEqual([f.lectura.ph, f.lectura.turbidez, f.lectura.conductividad, f.lectura.temperatura], [7.21, 1.4, 655, 22.4]);
  assert.strictEqual(f.lectura.distancia, null, "sin field5 la distancia queda null");
  assert.strictEqual(feedALectura(feed(8, 6, { field5: "41.2" }), CAMPOS, "x").lectura.distancia, 41.2);
});

test("campos vacíos quedan como null y lo imposible se descarta", () => {
  assert.strictEqual(feedALectura(feed(1, 0, { field2: null }), CAMPOS, "x").lectura.turbidez, null);
  assert.ok(feedALectura(feed(1, 0, { field1: "18" }), CAMPOS, "x").error);
  assert.ok(feedALectura({ entry_id: 1, created_at: "nada", field1: "7" }, CAMPOS, "x").error);
  assert.ok(feedALectura(feed(1, 0, { field1: null, field2: null, field3: null, field4: null }), CAMPOS, "x").error);
});

test("canal privado sin llave da un error claro", async () => {
  const estado = { feeds: [feed(1, 0)], peticiones: [], privado: true };
  const s = await servidorFalso(estado);
  const base = `http://127.0.0.1:${s.address().port}`;
  try {
    await assert.rejects(leerFeed({ base, canal: "123" }, 10), /privado/);
    assert.strictEqual((await leerFeed({ base, canal: "123", readKey: "LLAVE" }, 10)).length, 1);
  } finally { s.close(); }
});

const conDB = process.env.TEST_DB_NAME ? test : test.skip;

function crearPool(usuario, clave) {
  return require("mariadb").createPool({
    host: process.env.TEST_DB_HOST || "127.0.0.1",
    user: usuario, password: clave, database: process.env.TEST_DB_NAME,
    dateStrings: true, decimalAsNumber: true, insertIdAsNumber: true, bigIntAsNumber: true
  });
}

conDB("puente con MariaDB: historial, sin duplicados, nuevas y huecos", async () => {
  const { migrar } = require("../src/migrar");
  const admin = crearPool(process.env.TEST_DB_USER, process.env.TEST_DB_PASSWORD);
  await migrar(admin, { log: () => {} });
  await admin.query("DELETE FROM lecturas WHERE ts_canal = 123");

  // Con el usuario de la app (sin permisos de borrar ni crear) si está disponible
  const pool = process.env.TEST_DB_APP_USER ? crearPool(process.env.TEST_DB_APP_USER, process.env.TEST_DB_APP_PASSWORD) : admin;
  const estado = { feeds: [], peticiones: [] };
  for (let i = 1; i <= 150; i++) estado.feeds.push(feed(i, i % 60));
  estado.feeds[9].field1 = "25";                       // entrada 10 imposible: se descarta
  const s = await servidorFalso(estado);
  const cfg = { ...configDesdeEntorno({}), base: `http://127.0.0.1:${s.address().port}`, canal: "123", dispositivo: "esp32-1-ts" };

  try {
    // 1) Primera vez: 150 en el canal → pide 100, ve hueco y pide 8000
    let r = await sincronizar(pool, cfg);
    assert.deepStrictEqual([r.copiadas, r.descartadas, r.ultimo], [149, 1, 150]);
    assert.ok(estado.peticiones.some((q) => q.includes("results=8000")));

    // 2) Sin nada nuevo: no copia nada ni duplica
    r = await sincronizar(pool, cfg);
    assert.strictEqual(r.copiadas, 0);

    // 3) Llegan 3 nuevas
    estado.peticiones = [];
    for (let i = 151; i <= 153; i++) estado.feeds.push(feed(i, 30));
    r = await sincronizar(pool, cfg);
    assert.deepStrictEqual([r.copiadas, r.ultimo], [3, 153]);
    assert.ok(!estado.peticiones.some((q) => q.includes("results=8000")), "sin hueco no pide historial");

    // 4) Laptop apagada mientras llegaron 300: recupera todas
    for (let i = 154; i <= 453; i++) estado.feeds.push(feed(i, i % 60));
    r = await sincronizar(pool, cfg);
    assert.strictEqual(r.copiadas, 300);

    const filas = await admin.query(
      "SELECT COUNT(*) AS n, COUNT(DISTINCT ts_entry_id) AS u, MIN(origen) AS origen FROM lecturas WHERE ts_canal = 123");
    assert.deepStrictEqual([filas[0].n, filas[0].u, filas[0].origen], [452, 452, "thingspeak"]);
    const f = await admin.query("SELECT fecha FROM lecturas WHERE ts_canal = 123 AND ts_entry_id = 5");
    assert.strictEqual(f[0].fecha, "2026-11-21 18:05:00.000", "conserva la hora de ThingSpeak");
    const d = await admin.query("SELECT descripcion, ultima_conexion FROM dispositivos WHERE id = 'esp32-1-ts'");
    assert.match(d[0].descripcion, /ThingSpeak canal 123/);
    assert.ok(d[0].ultima_conexion);
  } finally {
    s.close();
    await admin.query("DELETE FROM lecturas WHERE ts_canal = 123");
    if (pool !== admin) await pool.end();
    await admin.end();
  }
});
