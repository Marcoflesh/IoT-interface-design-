-- Migración 007 · la turbidez se mide en porcentaje (0 % = agua limpia) en lugar de NTU.
-- Una lectura vieja en NTU no se puede convertir a %: si alguna pasa de 100 se borra ese valor
-- (solo la turbidez de esa fila; el resto de la lectura se queda).

UPDATE lecturas SET turbidez = NULL WHERE turbidez > 100;

ALTER TABLE lecturas
  MODIFY COLUMN turbidez DECIMAL(5,2) NULL COMMENT 'Turbidez en % (0 = agua limpia, 100 = opaca)';

INSERT IGNORE INTO schema_migraciones (version, nombre, aplicada)
VALUES ('007', 'turbidez_porcentaje', UTC_TIMESTAMP(3));
