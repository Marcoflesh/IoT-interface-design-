// API del monitoreo de calidad del agua.
//   POST /api/lecturas      el ESP32 guarda una lectura (requiere header X-API-Key)
//   GET  /api/lecturas      la página lee las últimas N (?limit=100&dispositivo=esp32-1)
//   GET  /api/dispositivos  estado de cada ESP32
//   GET  /api/salud         estado de la API y de la conexión a MariaDB

const crypto = require("node:crypto");
const express = require("express");
const { validarLectura, leerLimite, leerDispositivo } = require("./validar");

function hash(texto) {
  return crypto.createHash("sha256").update(String(texto)).digest();
}

// Compara llaves en tiempo constante (no revela cuántos caracteres coinciden).
function llaveValida(recibida, esperada) {
  if (!recibida) return false;
  return crypto.timingSafeEqual(hash(recibida), hash(esperada));
}

// MariaDB devuelve DATETIME como "2026-11-20 16:05:03.120" (UTC). Lo pasamos a ISO 8601.
function aISO(fecha) {
  return fecha ? fecha.replace(" ", "T") + "Z" : null;
}

const ERROR_BD = { error: "La API no puede conectarse a MariaDB." };

function crearApp(pool, apiKey) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2kb" }));

  // Lectura pública (solo GET), útil si la página se sirve desde otro puerto.
  app.use((req, res, next) => {
    if (req.method === "GET") res.set("Access-Control-Allow-Origin", "*");
    next();
  });

  app.get("/api/salud", async (req, res) => {
    try {
      const filas = await pool.query("SELECT COUNT(*) AS n, MAX(fecha) AS ultima FROM lecturas");
      res.json({ ok: true, base: "MariaDB", lecturas: Number(filas[0].n), ultima: aISO(filas[0].ultima) });
    } catch (e) {
      res.status(503).json({ ok: false, error: ERROR_BD.error });
    }
  });

  app.get("/api/lecturas", async (req, res) => {
    const limite = leerLimite(req.query.limit);
    const dispositivo = leerDispositivo(req.query.dispositivo);
    if (dispositivo === undefined) return res.status(400).json({ error: "dispositivo inválido." });
    try {
      const filas = await pool.query(
        "SELECT id, fecha, dispositivo, ph, turbidez, conductividad, temperatura, rssi " +
        "FROM lecturas " + (dispositivo ? "WHERE dispositivo = ? " : "") +
        "ORDER BY id DESC LIMIT ?",
        dispositivo ? [dispositivo, limite] : [limite]
      );
      const lecturas = filas.reverse().map((f) => ({ ...f, fecha: aISO(f.fecha) }));
      res.json({ canal: "MariaDB", lecturas });
    } catch (e) {
      res.status(503).json(ERROR_BD);
    }
  });

  app.get("/api/dispositivos", async (req, res) => {
    try {
      const filas = await pool.query(
        "SELECT id, descripcion, simulado, firmware, ultima_conexion, segundos_sin_datos, lecturas " +
        "FROM estado_dispositivos ORDER BY ultima_conexion IS NULL, ultima_conexion DESC"
      );
      res.json({
        dispositivos: filas.map((f) => ({ ...f, simulado: f.simulado === 1, ultima_conexion: aISO(f.ultima_conexion) }))
      });
    } catch (e) {
      res.status(503).json(ERROR_BD);
    }
  });

  app.post("/api/lecturas", async (req, res) => {
    if (!llaveValida(req.get("X-API-Key"), apiKey)) {
      return res.status(401).json({ error: "Falta el header X-API-Key o es incorrecto." });
    }
    const { lectura: l, error } = validarLectura(req.body);
    if (error) return res.status(400).json({ error });

    const ip = (req.get("X-Real-IP") || req.socket.remoteAddress || "").slice(0, 45);
    let conexion;
    try {
      conexion = await pool.getConnection();
      await conexion.beginTransaction();
      // Registra el dispositivo la primera vez y actualiza su última conexión.
      await conexion.query(
        "INSERT INTO dispositivos (id, descripcion, simulado, firmware, ultima_conexion, ultima_ip) " +
        "VALUES (?, 'Registrado automáticamente', ?, ?, UTC_TIMESTAMP(3), ?) " +
        "ON DUPLICATE KEY UPDATE ultima_conexion = VALUES(ultima_conexion), ultima_ip = VALUES(ultima_ip), " +
        "firmware = COALESCE(VALUES(firmware), firmware)",
        [l.dispositivo, l.simulado ? 1 : 0, l.firmware, ip]
      );
      const r = await conexion.query(
        "INSERT INTO lecturas (fecha, dispositivo, ph, turbidez, conductividad, temperatura, " +
        "rssi, ph_v, turbidez_v, conductividad_v) VALUES (UTC_TIMESTAMP(3), ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [l.dispositivo, l.ph, l.turbidez, l.conductividad, l.temperatura, l.rssi, l.ph_v, l.turbidez_v, l.conductividad_v]
      );
      await conexion.commit();
      res.status(201).json({ id: r.insertId });
    } catch (e) {
      if (conexion) await conexion.rollback().catch(() => {});
      res.status(503).json({ error: "No se pudo guardar en MariaDB." });
    } finally {
      if (conexion) conexion.release();
    }
  });

  app.use("/api", (req, res) => res.status(404).json({ error: "Ruta no encontrada." }));

  // JSON mal formado (por ejemplo, el ESP32 mandó nan en vez de null).
  app.use((err, req, res, next) => {
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "JSON inválido. Usa null para un sensor sin lectura." });
    if (err.type === "entity.too.large") return res.status(413).json({ error: "Cuerpo demasiado grande." });
    console.error(err);
    res.status(500).json({ error: "Error interno." });
  });

  return app;
}

module.exports = { crearApp, aISO };
