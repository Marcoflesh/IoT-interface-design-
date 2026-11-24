-- Migración 006 · un solo dispositivo: esp32-1, el ESP32 del equipo.
--   - Lo que el puente copió de ThingSpeak (antes esp32-1-ts) pasa a esp32-1.
--   - Se borra todo lo demás: esp32-sim, esp-32-sim, prueba-terminal, esp32-prueba-red, etc.
--   - Se quita la columna distancia (la agregó la migración 005, ya retirada).
-- Es un borrado definitivo: antes corran el respaldo (scripts/fedora/respaldar.sh).

INSERT IGNORE INTO dispositivos (id, descripcion, simulado) VALUES ('esp32-1', 'ESP32 del equipo', 0);

UPDATE lecturas SET dispositivo = 'esp32-1' WHERE dispositivo = 'esp32-1-ts';

DELETE FROM lecturas WHERE dispositivo <> 'esp32-1';

DELETE FROM calibraciones WHERE dispositivo <> 'esp32-1';

DELETE FROM dispositivos WHERE id <> 'esp32-1';

UPDATE dispositivos
SET descripcion = 'ESP32 del equipo',
    ultima_conexion = (SELECT MAX(fecha) FROM lecturas WHERE dispositivo = 'esp32-1')
WHERE id = 'esp32-1';

ALTER TABLE lecturas DROP COLUMN IF EXISTS distancia;

INSERT IGNORE INTO schema_migraciones (version, nombre, aplicada)
VALUES ('006', 'solo_esp32_1', UTC_TIMESTAMP(3));
