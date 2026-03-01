-- Migration 019: Registrera laget-projektet i projects-tabellen
-- Krävs för att cron_schedules FK-constraint ska fungera

INSERT IGNORE INTO projects (id, name, description) VALUES
  ('laget', 'Laget.se Närvaro', 'Aktiviteter och närvaro för Backatorp IF (laget.se)');
