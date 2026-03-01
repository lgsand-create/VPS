-- Migration 010: Konfigurerbar fillista för integrity-check
-- Istället för hårdkodad DEFAULT_CRITICAL_FILES kan varje sajt ha sin egen lista.
-- Sparas som newline-separerad text, t.ex. "public_html/index.php\npublic_html/.htaccess"

ALTER TABLE mon_sites
  ADD COLUMN IF NOT EXISTS integrity_files TEXT DEFAULT NULL COMMENT 'Filer att kontrollera (en per rad, relativ till webroot)';
