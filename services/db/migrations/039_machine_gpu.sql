-- Migration 039: GPU-overvakning for maskiner
-- Lagger till GPU-check-flagga, trosklar och dagliga metrics

-- mon_machines: GPU-stod
ALTER TABLE mon_machines ADD COLUMN IF NOT EXISTS check_gpu BOOLEAN DEFAULT FALSE;
ALTER TABLE mon_machines ADD COLUMN IF NOT EXISTS threshold_gpu_warn SMALLINT DEFAULT 85;
ALTER TABLE mon_machines ADD COLUMN IF NOT EXISTS threshold_gpu_crit SMALLINT DEFAULT 95;
ALTER TABLE mon_machines ADD COLUMN IF NOT EXISTS threshold_vram_warn SMALLINT DEFAULT 80;
ALTER TABLE mon_machines ADD COLUMN IF NOT EXISTS threshold_vram_crit SMALLINT DEFAULT 90;
ALTER TABLE mon_machines ADD COLUMN IF NOT EXISTS threshold_gpu_temp_warn SMALLINT DEFAULT 80;
ALTER TABLE mon_machines ADD COLUMN IF NOT EXISTS threshold_gpu_temp_crit SMALLINT DEFAULT 90;

-- mon_machine_daily_metrics: GPU-kolumner
ALTER TABLE mon_machine_daily_metrics ADD COLUMN IF NOT EXISTS avg_gpu_pct DECIMAL(5,2);
ALTER TABLE mon_machine_daily_metrics ADD COLUMN IF NOT EXISTS max_gpu_pct DECIMAL(5,2);
ALTER TABLE mon_machine_daily_metrics ADD COLUMN IF NOT EXISTS avg_vram_pct DECIMAL(5,2);
ALTER TABLE mon_machine_daily_metrics ADD COLUMN IF NOT EXISTS max_vram_pct DECIMAL(5,2);
ALTER TABLE mon_machine_daily_metrics ADD COLUMN IF NOT EXISTS avg_gpu_temp DECIMAL(5,2);
ALTER TABLE mon_machine_daily_metrics ADD COLUMN IF NOT EXISTS max_gpu_temp DECIMAL(5,2);
