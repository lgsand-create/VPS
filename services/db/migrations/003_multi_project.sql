-- Compuna Hub: Multi-projekt stöd
-- Byter namn på MinRidskola-tabeller med prefix, lägger till projekttabell.

-- Projekttabell (delad mellan alla projekt)
CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR(30) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT IGNORE INTO projects (id, name, description) VALUES
  ('minridskola', 'MinRidskola', 'Ridskolehantering för Stall Adams RF');

-- Scrape-log: lägg till projekt-kolumn
ALTER TABLE scrape_log ADD COLUMN project VARCHAR(30) DEFAULT 'minridskola';

-- Byt namn på MinRidskola-tabeller (projektprefix mrs_)
RENAME TABLE courses TO mrs_courses;
RENAME TABLE riders TO mrs_riders;
RENAME TABLE horses TO mrs_horses;
RENAME TABLE course_instances TO mrs_course_instances;
RENAME TABLE enrollments TO mrs_enrollments;
RENAME TABLE change_log TO mrs_change_log;
