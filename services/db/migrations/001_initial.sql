-- MinRidskola databas: initial schema
-- Körs via: npm run migrate

-- Kurser (referensregister)
CREATE TABLE IF NOT EXISTS courses (
  lnummer       VARCHAR(10) PRIMARY KEY,
  kursnamn      VARCHAR(100) NOT NULL,
  dag           VARCHAR(10) NOT NULL,
  tid           VARCHAR(20),
  plats         VARCHAR(100),
  ridlarare     VARCHAR(100),
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;

-- Ryttare (masterregister)
CREATE TABLE IF NOT EXISTS riders (
  id            VARCHAR(10) PRIMARY KEY,
  namn          VARCHAR(100) NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;

-- Hästar (masterregister)
CREATE TABLE IF NOT EXISTS horses (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  namn          VARCHAR(100) NOT NULL UNIQUE,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;

-- Lektionstillfällen (en kurs en specifik vecka)
CREATE TABLE IF NOT EXISTS course_instances (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  lnummer       VARCHAR(10) NOT NULL,
  vecka         VARCHAR(20) NOT NULL,
  datum         DATE,
  scraped_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_instance (lnummer, vecka),
  FOREIGN KEY (lnummer) REFERENCES courses(lnummer)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;

-- Bokningar/deltagare per tillfälle
CREATE TABLE IF NOT EXISTS enrollments (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  instance_id     INT NOT NULL,
  rider_id        VARCHAR(10) NOT NULL,
  horse_id        INT,
  avbokad         BOOLEAN DEFAULT FALSE,
  narvaro         BOOLEAN DEFAULT FALSE,
  UNIQUE KEY uq_enrollment (instance_id, rider_id),
  FOREIGN KEY (instance_id) REFERENCES course_instances(id),
  FOREIGN KEY (rider_id) REFERENCES riders(id),
  FOREIGN KEY (horse_id) REFERENCES horses(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;

-- Scraping-logg
CREATE TABLE IF NOT EXISTS scrape_log (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  scraper       VARCHAR(50) NOT NULL,
  status        ENUM('running','success','failed') DEFAULT 'running',
  started_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at   TIMESTAMP NULL,
  records       INT DEFAULT 0,
  error_message TEXT,
  json_file     VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;
