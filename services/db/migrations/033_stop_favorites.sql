-- Statistik: vilka hållplatser användare lägger till som favoriter
CREATE TABLE IF NOT EXISTS vt_stop_favorites (
  id INT AUTO_INCREMENT PRIMARY KEY,
  stop_area_gid VARCHAR(30) NOT NULL,
  stop_name VARCHAR(200) NOT NULL,
  added_count INT NOT NULL DEFAULT 1,
  last_added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_gid (stop_area_gid)
);
