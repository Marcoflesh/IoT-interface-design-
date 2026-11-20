-- Esquema de la base de datos del monitoreo de calidad del agua.
-- Lo ejecuta MariaDB la primera vez que arranca (docker-entrypoint-initdb.d)
-- y también la API al iniciar. Es idempotente: se puede correr varias veces.

CREATE TABLE IF NOT EXISTS lecturas (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fecha         DATETIME(3)  NOT NULL,                 -- en UTC
  dispositivo   VARCHAR(32)  NOT NULL DEFAULT 'esp32-1',
  ph            DECIMAL(4,2) NULL,
  turbidez      DECIMAL(7,2) NULL,                     -- NTU
  conductividad DECIMAL(8,1) NULL,                     -- µS/cm
  temperatura   DECIMAL(5,2) NULL,                     -- °C
  INDEX idx_fecha (fecha)
);

-- Resumen por día, útil para el reporte y la presentación.
CREATE OR REPLACE VIEW resumen_diario AS
SELECT
  DATE(fecha)                 AS dia,
  COUNT(*)                    AS lecturas,
  ROUND(AVG(ph), 2)           AS ph_promedio,
  ROUND(AVG(turbidez), 2)     AS turbidez_promedio,
  ROUND(AVG(conductividad), 1) AS conductividad_promedio,
  ROUND(AVG(temperatura), 2)  AS temperatura_promedio,
  ROUND(MIN(ph), 2)           AS ph_min,
  ROUND(MAX(ph), 2)           AS ph_max,
  ROUND(MAX(turbidez), 2)     AS turbidez_max,
  ROUND(MAX(conductividad), 1) AS conductividad_max
FROM lecturas
GROUP BY DATE(fecha);
