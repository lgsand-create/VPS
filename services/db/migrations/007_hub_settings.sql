-- Migration 007: Hub Settings
-- Centraliserad inställningshantering för SMTP, SMS, Firebase etc.
-- Ersätter env-variabler för konfigurerbara tjänster.

CREATE TABLE IF NOT EXISTS hub_settings (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  category      VARCHAR(30) NOT NULL,
  setting_key   VARCHAR(60) NOT NULL,
  setting_value TEXT,
  value_type    ENUM('string','number','boolean','password') DEFAULT 'string',
  label         VARCHAR(100) NOT NULL,
  description   VARCHAR(500),
  sort_order    SMALLINT DEFAULT 0,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_category_key (category, setting_key),
  INDEX idx_settings_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;

-- Seed: SMTP-inställningar
INSERT IGNORE INTO hub_settings (category, setting_key, setting_value, value_type, label, description, sort_order) VALUES
  ('smtp', 'enabled',      'false',   'boolean',  'Aktiverad',        'Aktivera e-postutskick',                              1),
  ('smtp', 'host',         NULL,      'string',   'SMTP-server',      'Hostname för SMTP-server (t.ex. smtp.gmail.com)',      2),
  ('smtp', 'port',         '587',     'number',   'Port',             'SMTP-port (587 för TLS, 465 för SSL)',                 3),
  ('smtp', 'user',         NULL,      'string',   'Användarnamn',     'SMTP-användarnamn (ofta e-postadress)',                4),
  ('smtp', 'password',     NULL,      'password', 'Lösenord',         'SMTP-lösenord',                                       5),
  ('smtp', 'from_address', NULL,      'string',   'Från-adress',      'Avsändaradress (t.ex. monitor@compuna.se)',            6),
  ('smtp', 'recipients',   NULL,      'string',   'Mottagare',        'Kommaseparerade e-postadresser för larm',              7);

-- Seed: HelloSMS-inställningar
INSERT IGNORE INTO hub_settings (category, setting_key, setting_value, value_type, label, description, sort_order) VALUES
  ('hellosms', 'enabled',     'false',   'boolean',  'Aktiverad',        'Aktivera SMS-utskick via HelloSMS',     1),
  ('hellosms', 'api_key',     NULL,      'password', 'API-nyckel',       'HelloSMS API-nyckel',                   2),
  ('hellosms', 'sender_name', NULL,      'string',   'Avsändarnamn',     'SMS-avsändarnamn (max 11 tecken)',      3),
  ('hellosms', 'recipient',   NULL,      'string',   'Mottagarnummer',   'Telefonnummer för larm-SMS',            4);

-- Seed: Firebase Push-inställningar
INSERT IGNORE INTO hub_settings (category, setting_key, setting_value, value_type, label, description, sort_order) VALUES
  ('firebase', 'enabled',     'false',   'boolean',  'Aktiverad',        'Aktivera Firebase push-notiser',          1),
  ('firebase', 'project_id',  NULL,      'string',   'Projekt-ID',       'Firebase projekt-ID',                     2),
  ('firebase', 'server_key',  NULL,      'password', 'Server-nyckel',    'Firebase Cloud Messaging server key',     3),
  ('firebase', 'vapid_key',   NULL,      'password', 'VAPID-nyckel',     'Web push VAPID public key',               4),
  ('firebase', 'sender_id',   NULL,      'string',   'Sändar-ID',        'Firebase Cloud Messaging sender ID',      5);
