-- Migración 001 · tabla de lecturas y resumen diario.
-- Cada archivo de esta carpeta se aplica una sola vez, en orden, y queda
-- registrado en schema_migraciones. Todas las sentencias son idempotentes.

CREATE TABLE IF NOT EXISTS schema_migraciones (
  version  CHAR(3)      NOT NULL PRIMARY KEY,
  nombre   VARCHAR(100) NOT NULL,
  aplicada DATETIME(3)  NOT NULL
);

CREATE TABLE IF NOT EXISTS lecturas (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fecha         DATETIME(3)  NOT NULL,
  dispositivo   VARCHAR(32)  NOT NULL DEFAULT 'esp32-1',
  ph            DECIMAL(4,2) NULL,
  turbidez      DECIMAL(7,2) NULL,
  conductividad DECIMAL(8,1) NULL,
  temperatura   DECIMAL(5,2) NULL,
  INDEX idx_fecha (fecha)
);

CREATE OR REPLACE VIEW resumen_diario AS
SELECT
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
GROUP BY DATE(fecha);

INSERT IGNORE INTO schema_migraciones (version, nombre, aplicada)
VALUES ('001', 'lecturas', UTC_TIMESTAMP(3));
