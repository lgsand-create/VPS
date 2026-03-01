-- Migration 005: CRON-schemahantering
-- Tillåter konfiguration av scheman via dashboard istället för att redigera config-filer

CREATE TABLE IF NOT EXISTS cron_schedules (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  project_id   VARCHAR(30) NOT NULL,
  mode         VARCHAR(20) NOT NULL,              -- 'quick', 'full', etc.
  cron_expr    VARCHAR(50) NOT NULL,              -- CRON-uttryck (t.ex. '*/15 * * * *')
  label        VARCHAR(100) NOT NULL,             -- Beskrivning (t.ex. 'Snabb (var 15 min)')
  args         VARCHAR(200) DEFAULT '',           -- Scraper-argument (t.ex. '--year')
  enabled      BOOLEAN DEFAULT TRUE,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_project_mode (project_id, mode),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
