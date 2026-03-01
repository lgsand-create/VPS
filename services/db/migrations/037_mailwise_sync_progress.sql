-- MailWise — Synkprogress-kolumner för live-feedback i dashboard

ALTER TABLE mw_mailboxes
  ADD COLUMN IF NOT EXISTS sync_progress INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sync_total INT DEFAULT 0;
