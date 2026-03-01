-- Migration 013: Stöd för lösenordsbaserad SFTP
-- one.com stödjer inte SSH-nycklar, kräver lösenord

ALTER TABLE mon_sites
  ADD COLUMN IF NOT EXISTS ssh_password VARCHAR(200) DEFAULT NULL
    COMMENT 'SFTP-lösenord (direkt, eller via ssh_password_env)',
  ADD COLUMN IF NOT EXISTS ssh_password_env VARCHAR(50) DEFAULT NULL
    COMMENT 'Env-variabelnamn som innehåller SFTP-lösenordet (t.ex. MON_STALLADAMS_SSH_PASS)';
