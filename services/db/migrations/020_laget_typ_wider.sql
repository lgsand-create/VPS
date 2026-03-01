-- Migration 020: Utöka typ-kolumnen i lag_activities
-- Vissa aktivitetstyper på laget.se är längre än 100 tecken

ALTER TABLE lag_activities MODIFY COLUMN typ VARCHAR(500);
