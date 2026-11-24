-- Migración 005 · distancia del sensor ultrasónico (HC-SR04T) a la superficie del agua, en cm.
-- Con la altura del tanque se saca el nivel: nivel = altura del sensor - distancia.

ALTER TABLE lecturas
  ADD COLUMN IF NOT EXISTS distancia DECIMAL(6,1) NULL COMMENT 'cm del HC-SR04T a la superficie del agua';

INSERT IGNORE INTO schema_migraciones (version, nombre, aplicada)
VALUES ('005', 'distancia', UTC_TIMESTAMP(3));
