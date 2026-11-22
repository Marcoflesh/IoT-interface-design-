-- Migración 003 · lecturas que vienen de ThingSpeak (puente ThingSpeak → MariaDB).
--   origen       → 'api' (el ESP32 mandó directo) o 'thingspeak' (lo copió el puente)
--   ts_canal     → Channel ID de ThingSpeak
--   ts_entry_id  → entry_id de ThingSpeak; con ts_canal evita copiar dos veces la misma lectura

ALTER TABLE lecturas
  ADD COLUMN IF NOT EXISTS origen      ENUM('api', 'thingspeak') NOT NULL DEFAULT 'api',
  ADD COLUMN IF NOT EXISTS ts_canal    INT UNSIGNED NULL COMMENT 'Channel ID de ThingSpeak',
  ADD COLUMN IF NOT EXISTS ts_entry_id INT UNSIGNED NULL COMMENT 'entry_id de ThingSpeak';

CREATE UNIQUE INDEX IF NOT EXISTS uq_thingspeak ON lecturas (ts_canal, ts_entry_id);

INSERT IGNORE INTO schema_migraciones (version, nombre, aplicada)
VALUES ('003', 'thingspeak', UTC_TIMESTAMP(3));
