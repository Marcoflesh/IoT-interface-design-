-- Migración 004 · se retira el ESP32 virtual: en la base solo queda el ESP32 real.
-- Borra todo lo del simulador: lo que mandó directo (esp32-sim) y lo que el puente
-- copió de un canal de pruebas de ThingSpeak (esp32-sim-ts), más sus calibraciones.
-- Es un borrado definitivo: antes corran el respaldo (scripts/fedora/respaldar.sh).

DELETE FROM lecturas
WHERE dispositivo LIKE 'esp32-sim%'
   OR dispositivo IN (SELECT id FROM dispositivos WHERE simulado = 1);

DELETE FROM calibraciones
WHERE dispositivo LIKE 'esp32-sim%'
   OR dispositivo IN (SELECT id FROM dispositivos WHERE simulado = 1);

DELETE FROM dispositivos
WHERE id LIKE 'esp32-sim%' OR simulado = 1;

INSERT IGNORE INTO schema_migraciones (version, nombre, aplicada)
VALUES ('004', 'retirar_simulador', UTC_TIMESTAMP(3));
