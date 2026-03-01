-- Migration 014: PWA Monitor App Settings
-- PIN-kod och konfiguration för mobilappen

INSERT IGNORE INTO hub_settings (category, setting_key, setting_value, value_type, label, description, sort_order) VALUES
  ('pwa', 'enabled',         'false', 'boolean',  'Aktiverad',           'Aktivera PWA-monitorappen', 1),
  ('pwa', 'pin_hash',        NULL,    'password', 'PIN-kod',             '4-6 siffror för inloggning i appen', 2),
  ('pwa', 'session_days',    '30',    'number',   'Session (dagar)',     'Hur länge man förblir inloggad', 3),
  ('pwa', 'refresh_seconds', '60',    'number',   'Auto-refresh (sek)', 'Intervall för automatisk uppdatering', 4);
