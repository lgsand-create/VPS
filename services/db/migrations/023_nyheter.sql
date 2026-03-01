-- Nyheter: Artiklar från Backatorp IF (backatorpif.se / laget.se)
-- Prefix: nyh_

-- Artiklar
CREATE TABLE IF NOT EXISTS nyh_articles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  news_id VARCHAR(20) NOT NULL,
  rubrik VARCHAR(500) NOT NULL,
  datum DATE,
  datum_raw VARCHAR(10),
  visningar INT DEFAULT 0,
  kommentarer INT DEFAULT 0,
  forfattare VARCHAR(200),
  url VARCHAR(500),
  bild VARCHAR(300),
  bild_url VARCHAR(500),
  text_content TEXT,
  data_hash VARCHAR(32),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_news_id (news_id),
  KEY idx_datum (datum),
  KEY idx_visningar (visningar)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;

-- Ändringslogg
CREATE TABLE IF NOT EXISTS nyh_change_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  article_id INT NOT NULL,
  field_name VARCHAR(50) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  scrape_file VARCHAR(200),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_article (article_id),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;

-- Registrera projektet
INSERT IGNORE INTO projects (id, name, description)
VALUES ('nyheter', 'Nyheter', 'Nyhetsartiklar från Backatorp IF (backatorpif.se)');
