-- Migration 022: Flerdagarsaktiviteter — slutdatum + heldagsflagga
-- Aktiviteter som sträcker sig över flera dagar (t.ex. cuper, läger)
-- lagras nu med start- och slutdatum. Heldagsaktiviteter markeras separat.

ALTER TABLE lag_activities ADD COLUMN IF NOT EXISTS datum_till DATE DEFAULT NULL AFTER datum;

ALTER TABLE lag_activities ADD COLUMN IF NOT EXISTS heldag BOOLEAN DEFAULT FALSE AFTER sluttid;

ALTER TABLE lag_activities ADD INDEX IF NOT EXISTS idx_datum_till (datum_till);
