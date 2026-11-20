// API del monitoreo de calidad del agua.
//   POST /api/lecturas   el ESP32 guarda una lectura (requiere header X-API-Key)
//   GET  /api/lecturas   la página lee las últimas N lecturas (?limit=100)
//   GET  /api/salud      estado de la API y de la conexión a MariaDB

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { validarLectura, leerLimite } = require("./validar");

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

async function asegurarEsquema(pool) {
  const sql = fs.readFileSync(path.join(__dirname, "esquema.sql"), "utf8")
    .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  for (const sentencia of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
    await pool.query(sentencia);
  }
}

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
      res.status(503).json({ ok: false, error: "La API no puede conectarse a MariaDB." });
    }
  });

  app.get("/api/lecturas", async (req, res) => {
    const limite = leerLimite(req.query.limit);
    try {
      const filas = await pool.query(
        "SELECT id, fecha, dispositivo, ph, turbidez, conductividad, temperatura " +
        "FROM lecturas ORDER BY id DESC LIMIT ?",
        [limite]
      );
      const lecturas = filas.reverse().map((f) => ({
        id: f.id,
        fecha: aISO(f.fecha),
        dispositivo: f.dispositivo,
        ph: f.ph,
        turbidez: f.turbidez,
        conductividad: f.conductividad,
        temperatura: f.temperatura
      }));
      res.json({ canal: "MariaDB", lecturas });
    } catch (e) {
      res.status(503).json({ error: "La API no puede conectarse a MariaDB." });
    }
  });

  app.post("/api/lecturas", async (req, res) => {
    if (!llaveValida(req.get("X-API-Key"), apiKey)) {
      return res.status(401).json({ error: "Falta el header X-API-Key o es incorrecto." });
    }
    const { lectura, error } = validarLectura(req.body);
    if (error) return res.status(400).json({ error });
    try {
      const r = await pool.query(
        "INSERT INTO lecturas (fecha, dispositivo, ph, turbidez, conductividad, temperatura) " +
        "VALUES (UTC_TIMESTAMP(3), ?, ?, ?, ?, ?)",
        [lectura.dispositivo, lectura.ph, lectura.turbidez, lectura.conductividad, lectura.temperatura]
      );
      res.status(201).json({ id: r.insertId });
    } catch (e) {
      res.status(503).json({ error: "No se pudo guardar en MariaDB." });
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

module.exports = { crearApp, asegurarEsquema, aISO };
