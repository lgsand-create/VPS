-- Hästindex: Utöka mrs_horses + skapa tabeller för foder, journaler, sjukskrivning, skoningar
-- Körs via: npm run migrate

-- ============================================
-- 1. UTÖKA mrs_horses med alla fält från Data-fliken
-- ============================================
ALTER TABLE mrs_horses
  ADD COLUMN IF NOT EXISTS hnummer       VARCHAR(10) UNIQUE AFTER id,
  ADD COLUMN IF NOT EXISTS typ           VARCHAR(20) AFTER namn,
  ADD COLUMN IF NOT EXISTS kon           VARCHAR(20) AFTER typ,
  ADD COLUMN IF NOT EXISTS fodelsear     SMALLINT AFTER kon,
  ADD COLUMN IF NOT EXISTS ras           VARCHAR(100) AFTER fodelsear,
  ADD COLUMN IF NOT EXISTS mankhojd      DECIMAL(4,1) AFTER ras,
  ADD COLUMN IF NOT EXISTS ponnykategori VARCHAR(5) AFTER mankhojd,
  ADD COLUMN IF NOT EXISTS farg          VARCHAR(50) AFTER ponnykategori,
  ADD COLUMN IF NOT EXISTS tecken        VARCHAR(200) AFTER farg,
  ADD COLUMN IF NOT EXISTS harstamning   VARCHAR(200) AFTER tecken,
  ADD COLUMN IF NOT EXISTS uppfodare     VARCHAR(100) AFTER harstamning,
  ADD COLUMN IF NOT EXISTS agare         VARCHAR(100) AFTER uppfodare,
  ADD COLUMN IF NOT EXISTS bortrest      BOOLEAN DEFAULT FALSE AFTER agare,
  ADD COLUMN IF NOT EXISTS privathast    BOOLEAN DEFAULT FALSE AFTER bortrest,
  ADD COLUMN IF NOT EXISTS lektionshast  BOOLEAN DEFAULT TRUE AFTER privathast,
  ADD COLUMN IF NOT EXISTS stall         VARCHAR(50) AFTER lektionshast,
  ADD COLUMN IF NOT EXISTS stallplats_nr VARCHAR(20) AFTER stall,
  ADD COLUMN IF NOT EXISTS inkopsdatum   DATE AFTER stallplats_nr,
  ADD COLUMN IF NOT EXISTS avford_datum  DATE AFTER inkopsdatum,
  ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- ============================================
-- 2. FODER (konfiguration — 8 rader × 5 fodringar per dag)
-- ============================================
CREATE TABLE IF NOT EXISTS mrs_horse_feed (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  horse_id    INT NOT NULL,
  rad_nr      TINYINT NOT NULL,
  fodersort   VARCHAR(50),
  fodring_1   VARCHAR(20) DEFAULT '',
  fodring_2   VARCHAR(20) DEFAULT '',
  fodring_3   VARCHAR(20) DEFAULT '',
  fodring_4   VARCHAR(20) DEFAULT '',
  fodring_5   VARCHAR(20) DEFAULT '',
  UNIQUE KEY uq_feed (horse_id, rad_nr),
  FOREIGN KEY (horse_id) REFERENCES mrs_horses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;

-- ============================================
-- 3. JOURNALER (vaccination, avmaskning, dagbok)
-- ============================================
CREATE TABLE IF NOT EXISTS mrs_horse_journals (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  horse_id    INT NOT NULL,
  typ         VARCHAR(30) NOT NULL,
  datum       DATE NOT NULL,
  till_datum  DATE,
  beskrivning TEXT,
  UNIQUE KEY uq_journal (horse_id, typ, datum, beskrivning(100)),
  FOREIGN KEY (horse_id) REFERENCES mrs_horses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;

-- ============================================
-- 4. SJUKSKRIVNINGAR
-- ============================================
CREATE TABLE IF NOT EXISTS mrs_horse_sick_leave (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  horse_id    INT NOT NULL,
  datum_from  DATE NOT NULL,
  datum_to    DATE,
  orsak       VARCHAR(200),
  UNIQUE KEY uq_sick (horse_id, datum_from),
  FOREIGN KEY (horse_id) REFERENCES mrs_horses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;

-- ============================================
-- 5. SKONINGAR
-- ============================================
CREATE TABLE IF NOT EXISTS mrs_horse_shoeing (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  horse_id    INT NOT NULL,
  datum       DATE NOT NULL,
  notering    VARCHAR(500),
  UNIQUE KEY uq_shoeing (horse_id, datum),
  FOREIGN KEY (horse_id) REFERENCES mrs_horses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;
