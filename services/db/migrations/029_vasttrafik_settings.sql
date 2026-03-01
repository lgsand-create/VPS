-- Västtrafik — Hub-inställningar
INSERT IGNORE INTO hub_settings (category, setting_key, setting_value, value_type, label, description, sort_order) VALUES
  ('vasttrafik', 'enabled',        'false', 'boolean',  'Aktiverad',           'Aktivera Västtrafik-pollingen',        1),
  ('vasttrafik', 'client_id',      NULL,    'string',   'Client ID',           'Västtrafik API Client ID',             2),
  ('vasttrafik', 'client_secret',  NULL,    'password', 'Client Secret',       'Västtrafik API Client Secret',         3),
  ('vasttrafik', 'vapid_public',   NULL,    'string',   'VAPID Public Key',    'Web Push VAPID public key',            4),
  ('vasttrafik', 'vapid_private',  NULL,    'password', 'VAPID Private Key',   'Web Push VAPID private key',           5),
  ('vasttrafik', 'vapid_email',    'mailto:jonas@compuna.se', 'string', 'VAPID E-post', 'Kontaktadress för VAPID',    6),
  ('vasttrafik', 'poll_interval',  '60',    'number',   'Pollintervall (sek)', 'Hur ofta avgångar hämtas (sekunder)',   7),
  ('vasttrafik', 'cache_ttl',      '60',    'number',   'Cache TTL (sek)',     'Hur länge API-svar cachas i minnet',    8),
  ('vasttrafik', 'retention_days', '90',    'number',   'Historik (dagar)',    'Hur länge avgångsdata sparas i DB',     9);
