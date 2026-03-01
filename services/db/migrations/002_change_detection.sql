ALTER TABLE course_instances
  ADD COLUMN data_hash CHAR(32) DEFAULT NULL;

CREATE TABLE IF NOT EXISTS change_log (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  instance_id  INT NOT NULL,
  rider_id     VARCHAR(10) NOT NULL,
  field_name   VARCHAR(30) NOT NULL,
  old_value    VARCHAR(100),
  new_value    VARCHAR(100),
  detected_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  scrape_file  VARCHAR(255),
  FOREIGN KEY (instance_id) REFERENCES course_instances(id),
  INDEX idx_change_instance (instance_id),
  INDEX idx_change_rider (rider_id),
  INDEX idx_change_detected (detected_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_swedish_ci;
