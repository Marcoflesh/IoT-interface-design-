// Migrador: aplica, en orden, los archivos api/migraciones/NNN_nombre.sql que falten.
// Cada archivo se registra a sí mismo en schema_migraciones.
const fs = require("node:fs");
const path = require("node:path");

const DIR = path.join(__dirname, "..", "migraciones");
const SIN_PERMISO = new Set([1044, 1142, 1143, 1227]); // errores de acceso de MariaDB

function listarMigraciones(dir = DIR) {
  return fs.readdirSync(dir).filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f)).sort();
}

function sentencias(sql) {
  return sql
    .split("\n")
    .filter((linea) => !linea.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function versionesAplicadas(pool) {
  try {
    const filas = await pool.query("SELECT version FROM schema_migraciones");
    return new Set(filas.map((f) => f.version));
  } catch (e) {
    if (e.errno === 1146) return new Set(); // la tabla aún no existe
    throw e;
  }
}

async function migrar(pool, { dir = DIR, log = console.log } = {}) {
  const aplicadas = await versionesAplicadas(pool);
  const pendientes = listarMigraciones(dir).filter((f) => !aplicadas.has(f.slice(0, 3)));
  for (const archivo of pendientes) {
    const sql = fs.readFileSync(path.join(dir, archivo), "utf8");
    try {
      for (const s of sentencias(sql)) await pool.query(s);
    } catch (e) {
      if (SIN_PERMISO.has(e.errno)) {
        throw new Error(`La migración ${archivo} necesita permisos de administrador. ` +
          "En Fedora corre: bash scripts/fedora/preparar-mariadb.sh");
      }
      throw new Error(`Falló la migración ${archivo}: ${e.message}`);
    }
    log(`Migración aplicada: ${archivo}`);
  }
  return pendientes;
}

module.exports = { migrar, listarMigraciones, sentencias };
