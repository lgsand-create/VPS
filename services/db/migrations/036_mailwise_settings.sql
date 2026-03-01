-- MailWise — Hub-inställningar

INSERT IGNORE INTO hub_settings (category, setting_key, setting_value, value_type, label, description, sort_order) VALUES
  ('mailwise', 'enabled',         'false',            'boolean',  'Aktiverad',            'Aktivera MailWise Gmail-synkning',                           1),
  ('mailwise', 'ollama_host',     '10.10.10.104',     'string',   'Ollama-host',          'IP-adress till Ollama-server (Proxmox via WireGuard)',        2),
  ('mailwise', 'ollama_port',     '11434',            'number',   'Ollama-port',          'Port för Ollama REST API',                                   3),
  ('mailwise', 'ollama_model',    'llama3.1:8b',      'string',   'LLM-modell',           'Ollama-modell för analys (t.ex. llama3.1:8b, qwen2.5:32b)',  4),
  ('mailwise', 'sync_interval',   '300',              'number',   'Synkintervall (sek)',   'Hur ofta Gmail-brevlådor synkas (sekunder)',                 5),
  ('mailwise', 'auto_analyze',    'true',             'boolean',  'Autoanalys',           'Analysera nya meddelanden automatiskt med LLM',               6),
  ('mailwise', 'retention_days',  '365',              'number',   'Historik (dagar)',      'Hur länge e-postdata sparas i databasen',                    7),
  ('mailwise', 'redirect_uri',    'https://vpn.compuna.se/api/mailwise/oauth/callback', 'string', 'OAuth2 Redirect URI', 'Callback-URL för Google OAuth2 (måste matcha i GCP)', 8);
