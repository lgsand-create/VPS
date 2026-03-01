-- Västtrafik — Credentials i hub_settings (komplement till 029)
INSERT IGNORE INTO hub_settings (category, setting_key, setting_value, value_type, label, description, sort_order) VALUES
  ('vasttrafik', 'client_id',      NULL,    'string',   'Client ID',           'Västtrafik API Client ID',             2),
  ('vasttrafik', 'client_secret',  NULL,    'password', 'Client Secret',       'Västtrafik API Client Secret',         3),
  ('vasttrafik', 'vapid_public',   NULL,    'string',   'VAPID Public Key',    'Web Push VAPID public key',            4),
  ('vasttrafik', 'vapid_private',  NULL,    'password', 'VAPID Private Key',   'Web Push VAPID private key',           5),
  ('vasttrafik', 'vapid_email',    'mailto:jonas@compuna.se', 'string', 'VAPID E-post', 'Kontaktadress för VAPID',    6);
