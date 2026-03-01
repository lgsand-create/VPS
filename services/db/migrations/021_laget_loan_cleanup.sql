-- Migration 021: Inlånade spelare — låneflagga + namnrensning
-- Spelare som lånas från annat lag visas som "Erik Tomazic - BackatorpIFpf09"
-- Vi sparar ursprungslaget separat och rensar namnet för korrekt deduplicering.

ALTER TABLE lag_attendance ADD COLUMN IF NOT EXISTS inlanad_fran VARCHAR(100) DEFAULT NULL;

-- Nollställ hashar så att nästa import ombearbetar allt med rena namn
UPDATE lag_activities SET data_hash = NULL;

-- Ta bort befintliga dubbletter (medlemmar med lagslug i namnet).
-- Dessa återskapas med rena namn vid nästa import.
-- Steg 1: Ta bort attendance-rader som pekar på "smutsiga" medlemmar
DELETE att FROM lag_attendance att
JOIN lag_members m ON m.id = att.member_id
WHERE m.namn LIKE '% - Backatorp%';

-- Steg 2: Ta bort de smutsiga medlemmarna
DELETE FROM lag_members WHERE namn LIKE '% - Backatorp%';
