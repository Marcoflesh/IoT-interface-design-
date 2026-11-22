-- Migración 002 · dispositivos, diagnóstico y calibraciones.
--   dispositivos   → qué ESP32 existen (real o simulado) y cuándo se conectaron
--   lecturas       → + intensidad WiFi y voltajes crudos de cada sensor
--   calibraciones  → historial de calibraciones por sensor
--   vistas         → resumen diario por dispositivo, estado de cada dispositivo

CREATE TABLE IF NOT EXISTS dispositivos (
  id              VARCHAR(32)  NOT NULL PRIMARY KEY,
  descripcion     VARCHAR(120) NULL,
  simulado        TINYINT(1)   NOT NULL DEFAULT 0,
  firmware        VARCHAR(32)  NULL,
  creado          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ultima_conexion DATETIME(3)  NULL,
  ultima_ip       VARCHAR(45)  NULL
);

INSERT IGNORE INTO dispositivos (id, descripcion, simulado) VALUES
  ('esp32-1',   'ESP32 del equipo',           0),
  ('esp32-sim', 'ESP32 virtual (simulador)',  1);

-- Dispositivos que ya mandaron datos antes de esta migración.
INSERT IGNORE INTO dispositivos (id, descripcion)
SELECT DISTINCT dispositivo, 'Registrado por la migración 002' FROM lecturas;

ALTER TABLE lecturas
  ADD COLUMN IF NOT EXISTS rssi            SMALLINT     NULL COMMENT 'Intensidad WiFi en dBm',
  ADD COLUMN IF NOT EXISTS ph_v            DECIMAL(5,3) NULL COMMENT 'Voltaje del módulo de pH',
  ADD COLUMN IF NOT EXISTS turbidez_v      DECIMAL(5,3) NULL COMMENT 'Voltaje del sensor de turbidez',
  ADD COLUMN IF NOT EXISTS conductividad_v DECIMAL(5,3) NULL COMMENT 'Voltaje del módulo TDS';

CREATE INDEX IF NOT EXISTS idx_dispositivo_fecha ON lecturas (dispositivo, fecha);

ALTER TABLE lecturas
  ADD CONSTRAINT fk_lecturas_dispositivo FOREIGN KEY IF NOT EXISTS (dispositivo) REFERENCES dispositivos (id);

CREATE TABLE IF NOT EXISTS calibraciones (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dispositivo VARCHAR(32)  NOT NULL,
  sensor      ENUM('ph', 'turbidez', 'conductividad', 'temperatura') NOT NULL,
  fecha       DATETIME(3)  NOT NULL,
  puntos      JSON         NULL COMMENT 'Ej. [{"referencia":7.0,"voltaje":2.51}]',
  pendiente   DOUBLE       NULL,
  ordenada    DOUBLE       NULL,
  notas       VARCHAR(255) NULL,
  INDEX idx_cal_sensor (dispositivo, sensor, fecha),
  CONSTRAINT fk_cal_dispositivo FOREIGN KEY (dispositivo) REFERENCES dispositivos (id)
);

CREATE OR REPLACE VIEW resumen_diario AS
SELECT
  dispositivo,
  DATE(fecha)                  AS dia,
  COUNT(*)                     AS lecturas,
  ROUND(AVG(ph), 2)            AS ph_promedio,
  ROUND(AVG(turbidez), 2)      AS turbidez_promedio,
  ROUND(AVG(conductividad), 1) AS conductividad_promedio,
  ROUND(AVG(temperatura), 2)   AS temperatura_promedio,
  ROUND(MIN(ph), 2)            AS ph_min,
  ROUND(MAX(ph), 2)            AS ph_max,
  ROUND(MAX(turbidez), 2)      AS turbidez_max,
  ROUND(MAX(conductividad), 1) AS conductividad_max
FROM lecturas
GROUP BY dispositivo, DATE(fecha);

CREATE OR REPLACE VIEW estado_dispositivos AS
SELECT
  d.id,
  d.descripcion,
  d.simulado,
  d.firmware,
  d.ultima_conexion,
  d.ultima_ip,
  TIMESTAMPDIFF(SECOND, d.ultima_conexion, UTC_TIMESTAMP()) AS segundos_sin_datos,
  (SELECT COUNT(*) FROM lecturas l WHERE l.dispositivo = d.id) AS lecturas
FROM dispositivos d;

INSERT IGNORE INTO schema_migraciones (version, nombre, aplicada)
VALUES ('002', 'dispositivos_y_diagnostico', UTC_TIMESTAMP(3));
