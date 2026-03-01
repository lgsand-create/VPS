-- Migration 025: Registrera bgcheck-projektet i projects-tabellen
-- Krävs för att api_keys FK-constraint (project_id) ska fungera

INSERT IGNORE INTO projects (id, name, description) VALUES
  ('bgcheck', 'Bakgrundskontroll', 'Verifiering av belastningsregisterutdrag via Polisen');
