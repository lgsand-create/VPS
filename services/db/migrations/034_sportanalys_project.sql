-- Sportanalys + Västtrafik: Lägg till i projects-tabellen
-- Krävs för att api_keys FK-constraint ska tillåta nycklar för dessa projekt

INSERT IGNORE INTO projects (id, name, description) VALUES
  ('sportanalys', 'Sportanalys', 'Videoanalys av matcher — upload, bearbetning och resultat');

INSERT IGNORE INTO projects (id, name, description) VALUES
  ('vasttrafik', 'Västtrafik', 'Realtidsavgångar och förseningsstatistik');
