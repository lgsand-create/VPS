-- Laget.se: Aktiviteter och närvaro för Backatorp IF
-- Prefix: lag_

-- Lag/grupper
CREATE TABLE IF NOT EXISTS lag_teams (
  id VARCHAR(20) PRIMARY KEY,
  slug VARCHAR(100) NOT NULL,
  namn VARCHAR(100) NOT NULL,
  aktiv BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed: Alla 19 fotbollslag
INSERT IGNORE INTO lag_teams (id, slug, namn) VALUES
  ('alag',   'BackatorpIF-Fotboll-HerrAlag',       'A-Lag (Herr)'),
  ('u17',    'BackatorpIF-Fotboll-U17Herr',         'U17 (Herr)'),
  ('p12',    'BackatorpIFP12Fotboll',               'P-12 Fotboll'),
  ('p13',    'BackatorpIFPF13',                     'P-13 Fotboll'),
  ('p14',    'BackatorpIFPF14',                     'P-14 Fotboll'),
  ('p15',    'BackatorpIFPF15',                     'P-15 Fotboll'),
  ('p16',    'BackatorpIF-Fotboll-FP-16Fotboll',    'P-16 Fotboll'),
  ('p17',    'BackatorpIF-Fotboll-P17',             'P-2017 Fotboll'),
  ('p18',    'BackatorpIF-Fotboll-P-2018',          'P-2018 Fotboll'),
  ('p19',    'BackatorpIF-Fotboll-FotbollP2019',    'P-2019 Fotboll'),
  ('p20',    'BackatorpIF-Fotboll-P2020',           'P-2020 Fotboll'),
  ('uflick', 'BackatorpIF-U-flickor-Fotboll',       'U-flickor Fotboll'),
  ('f1112',  'BackatorpIF-Knattelag-Fotboll',       'F-11/12 Fotboll'),
  ('f1314',  'BackatorpF1314',                      'F-13/14 Fotboll'),
  ('f1516',  'BackatorpIF-Fotboll-F15-16',          'F-15/16 Fotboll'),
  ('f17',    'BackatorpIF-Fotboll-F-17',             'F-2017 Fotboll'),
  ('f18',    'BackatorpIF-Fotboll-F-2018',           'F-2018 Fotboll'),
  ('f19',    'BackatorpIF-Fotboll-FotbollF2019',     'F-2019 Fotboll'),
  ('f20',    'BackatorpIF-Fotboll-F-2020',           'F-2020 Fotboll');

-- Aktiviteter (en rad per event)
CREATE TABLE IF NOT EXISTS lag_activities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id VARCHAR(20) NOT NULL,
  team_id VARCHAR(20) NOT NULL,
  datum DATE,
  starttid VARCHAR(10),
  sluttid VARCHAR(10),
  typ VARCHAR(100),
  plats VARCHAR(200),
  lok_aktivitet BOOLEAN,
  genomford BOOLEAN DEFAULT FALSE,
  raw_date_text VARCHAR(200),
  data_hash VARCHAR(32),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_event_team (event_id, team_id),
  KEY idx_team_datum (team_id, datum),
  KEY idx_datum (datum),
  FOREIGN KEY (team_id) REFERENCES lag_teams(id)
);

-- Medlemmar (spelare och ledare, deduplicerade på namn)
CREATE TABLE IF NOT EXISTS lag_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  namn VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_namn (namn)
);

-- Närvaro per aktivitet per medlem
CREATE TABLE IF NOT EXISTS lag_attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  activity_id INT NOT NULL,
  member_id INT NOT NULL,
  roll ENUM('deltagare', 'ledare') NOT NULL DEFAULT 'deltagare',
  status VARCHAR(30) NOT NULL,
  kommentar VARCHAR(500) DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_activity_member (activity_id, member_id),
  KEY idx_member (member_id),
  KEY idx_status (status),
  FOREIGN KEY (activity_id) REFERENCES lag_activities(id) ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES lag_members(id)
);

-- Ändringslogg
CREATE TABLE IF NOT EXISTS lag_change_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  activity_id INT NOT NULL,
  member_id INT,
  field_name VARCHAR(50) NOT NULL,
  old_value VARCHAR(200),
  new_value VARCHAR(200),
  scrape_file VARCHAR(200),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_activity (activity_id),
  KEY idx_created (created_at)
);
