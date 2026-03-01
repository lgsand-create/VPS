-- MailWise — AI-driven e-posthantering
-- Multi-brevlåda Gmail-integration med LLM-analys.

-- Gmail-konton med OAuth2-tokens
CREATE TABLE IF NOT EXISTS mw_mailboxes (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  email           VARCHAR(255) NOT NULL UNIQUE,
  display_name    VARCHAR(200),
  -- OAuth2 tokens (krypterade med AES-256-GCM)
  access_token    TEXT,
  refresh_token   TEXT,
  token_expires_at DATETIME,
  -- Google OAuth2 client credentials (per brevlåda — stödjer flera GCP-projekt)
  client_id       VARCHAR(500),
  client_secret   TEXT,
  -- Sync-state
  history_id      VARCHAR(50),
  last_sync_at    DATETIME,
  sync_status     ENUM('idle','syncing','error') DEFAULT 'idle',
  sync_error      VARCHAR(500),
  -- Inställningar
  enabled         BOOLEAN DEFAULT TRUE,
  auto_analyze    BOOLEAN DEFAULT TRUE,
  labels_filter   JSON,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mw_mb_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- E-postmeddelanden
CREATE TABLE IF NOT EXISTS mw_messages (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  mailbox_id      INT NOT NULL,
  gmail_id        VARCHAR(50) NOT NULL,
  thread_id       VARCHAR(50),
  subject         VARCHAR(500),
  from_address    VARCHAR(255),
  from_name       VARCHAR(200),
  to_addresses    JSON,
  cc_addresses    JSON,
  date            DATETIME NOT NULL,
  snippet         TEXT,
  body_text       MEDIUMTEXT,
  body_html       MEDIUMTEXT,
  labels          JSON,
  is_read         BOOLEAN DEFAULT FALSE,
  is_starred      BOOLEAN DEFAULT FALSE,
  has_attachments BOOLEAN DEFAULT FALSE,
  size_estimate   INT DEFAULT 0,
  -- LLM-analys
  category        VARCHAR(50),
  priority        ENUM('low','normal','high','urgent'),
  sentiment       ENUM('positive','neutral','negative'),
  summary         TEXT,
  analyzed_at     DATETIME,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mw_msg (mailbox_id, gmail_id),
  INDEX idx_mw_msg_thread (mailbox_id, thread_id),
  INDEX idx_mw_msg_date (mailbox_id, date DESC),
  INDEX idx_mw_msg_category (mailbox_id, category),
  INDEX idx_mw_msg_priority (priority),
  INDEX idx_mw_msg_unanalyzed (analyzed_at),
  FOREIGN KEY (mailbox_id) REFERENCES mw_mailboxes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- E-posttrådar
CREATE TABLE IF NOT EXISTS mw_threads (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  mailbox_id      INT NOT NULL,
  gmail_thread_id VARCHAR(50) NOT NULL,
  subject         VARCHAR(500),
  message_count   INT DEFAULT 0,
  last_message_at DATETIME,
  participants    JSON,
  -- LLM-analys
  thread_summary  TEXT,
  resolved        BOOLEAN DEFAULT FALSE,
  analyzed_at     DATETIME,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mw_thread (mailbox_id, gmail_thread_id),
  INDEX idx_mw_thread_last (mailbox_id, last_message_at DESC),
  FOREIGN KEY (mailbox_id) REFERENCES mw_mailboxes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Gmail-etiketter
CREATE TABLE IF NOT EXISTS mw_labels (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  mailbox_id      INT NOT NULL,
  gmail_label_id  VARCHAR(100) NOT NULL,
  name            VARCHAR(200) NOT NULL,
  type            ENUM('system','user') DEFAULT 'user',
  message_count   INT DEFAULT 0,
  synced_at       DATETIME,
  UNIQUE KEY uq_mw_label (mailbox_id, gmail_label_id),
  FOREIGN KEY (mailbox_id) REFERENCES mw_mailboxes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bearbetningsjobb
CREATE TABLE IF NOT EXISTS mw_jobs (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  mailbox_id      INT,
  type            ENUM('analyze_message','analyze_thread','extract_faq','batch_analyze','label_sync') NOT NULL,
  status          ENUM('pending','processing','completed','failed') DEFAULT 'pending',
  progress        SMALLINT DEFAULT 0,
  total_items     INT DEFAULT 0,
  processed_items INT DEFAULT 0,
  input_data      JSON,
  result_data     JSON,
  error_message   VARCHAR(1000),
  started_at      DATETIME,
  finished_at     DATETIME,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mw_job_status (status),
  INDEX idx_mw_job_type (type, status),
  INDEX idx_mw_job_mailbox (mailbox_id),
  FOREIGN KEY (mailbox_id) REFERENCES mw_mailboxes(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Jobbloggar
CREATE TABLE IF NOT EXISTS mw_job_logs (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  job_id          BIGINT NOT NULL,
  level           ENUM('info','warn','error') DEFAULT 'info',
  message         VARCHAR(1000) NOT NULL,
  data            JSON,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mw_jlog_job (job_id),
  FOREIGN KEY (job_id) REFERENCES mw_jobs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Extraherade FAQ-par
CREATE TABLE IF NOT EXISTS mw_faqs (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  mailbox_id      INT NOT NULL,
  question        TEXT NOT NULL,
  answer          TEXT NOT NULL,
  source_thread_id VARCHAR(50),
  source_messages JSON,
  confidence      DECIMAL(3,2),
  tags            JSON,
  approved        BOOLEAN DEFAULT FALSE,
  archived        BOOLEAN DEFAULT FALSE,
  job_id          BIGINT,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_mw_faq_mailbox (mailbox_id, approved),
  INDEX idx_mw_faq_confidence (confidence DESC),
  FOREIGN KEY (mailbox_id) REFERENCES mw_mailboxes(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES mw_jobs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Meddelandekategorier (anpassningsbara per brevlåda)
CREATE TABLE IF NOT EXISTS mw_categories (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  mailbox_id      INT NOT NULL,
  name            VARCHAR(50) NOT NULL,
  display_name    VARCHAR(100) NOT NULL,
  description     VARCHAR(300),
  color           VARCHAR(10) DEFAULT '#6b7280',
  sort_order      SMALLINT DEFAULT 0,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mw_cat (mailbox_id, name),
  FOREIGN KEY (mailbox_id) REFERENCES mw_mailboxes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Föreslagna svar
CREATE TABLE IF NOT EXISTS mw_draft_replies (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  mailbox_id      INT NOT NULL,
  message_id      BIGINT NOT NULL,
  draft_text      TEXT NOT NULL,
  tone            ENUM('formal','friendly','concise') DEFAULT 'friendly',
  confidence      DECIMAL(3,2),
  used            BOOLEAN DEFAULT FALSE,
  job_id          BIGINT,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mw_draft_msg (message_id),
  FOREIGN KEY (mailbox_id) REFERENCES mw_mailboxes(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES mw_messages(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES mw_jobs(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Daglig statistik per brevlåda
CREATE TABLE IF NOT EXISTS mw_daily_metrics (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  mailbox_id          INT NOT NULL,
  date                DATE NOT NULL,
  messages_received   INT DEFAULT 0,
  messages_analyzed   INT DEFAULT 0,
  faqs_extracted      INT DEFAULT 0,
  drafts_generated    INT DEFAULT 0,
  avg_response_time_m INT,
  category_breakdown  JSON,
  priority_breakdown  JSON,
  sentiment_breakdown JSON,
  UNIQUE KEY uq_mw_daily (mailbox_id, date),
  INDEX idx_mw_daily_date (date),
  FOREIGN KEY (mailbox_id) REFERENCES mw_mailboxes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Standardkategorier (skapas per brevlåda vid setup)
-- Hanteras av applikationskod, inte seed-data
