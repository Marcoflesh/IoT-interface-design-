// Arranque de la API: conecta a MariaDB, asegura el esquema y escucha en el puerto 3000.
const mariadb = require("mariadb");
const { crearApp } = require("./app");
const { migrar } = require("./migrar");

const PUERTO = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";   // 127.0.0.1 en Fedora (red del equipo)
const API_KEY = process.env.ESP32_API_KEY || "";

if (API_KEY.length < 16) {
  console.error("ESP32_API_KEY falta o es muy corta (mínimo 16 caracteres). Revisa el archivo .env.");
  process.exit(1);
}

const pool = mariadb.createPool({
  host: process.env.DB_HOST || "db",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 5,
  dateStrings: true,
  decimalAsNumber: true,
  insertIdAsNumber: true,
  bigIntAsNumber: true
});

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function iniciar() {
  for (let intento = 1; intento <= 15; intento++) {
    try {
      await migrar(pool);
      break;
    } catch (e) {
      if (/permisos de administrador|Falló la migración/.test(e.message)) {
        console.error(e.message);
        process.exit(1);
      }
      console.log(`Esperando a MariaDB (intento ${intento}/15): ${e.code || e.message}`);
      if (intento === 15) process.exit(1);
      await esperar(2000);
    }
  }
  const servidor = crearApp(pool, API_KEY, process.env.THINGSPEAK_CHANNEL_ID).listen(PUERTO, HOST, () => {
    console.log(`API lista en ${HOST}:${PUERTO}`);
  });
  const cerrar = () => servidor.close(() => pool.end().then(() => process.exit(0)));
  process.on("SIGTERM", cerrar);
  process.on("SIGINT", cerrar);
}

iniciar();
