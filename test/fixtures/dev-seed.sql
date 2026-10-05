DELETE FROM notes; DELETE FROM ratings; DELETE FROM ideas; DELETE FROM pending; DELETE FROM settings; DELETE FROM users;
INSERT INTO users (id, name, email) VALUES ('a', 'Traveller A', 'a@example.com'), ('b', 'Traveller B', 'b@example.com');
INSERT INTO settings (key, value) VALUES ('departure_date', '2030-01-01'), ('budget_eur', '50000'), ('flight_reserve_eur', '5000');
INSERT INTO ideas (title, kind, description, lat, lng, country_iso, region, added_by, must_do, cost_pp_day, price_season, climate, created_at, updated_at) VALUES
 ('Five-lakes hike', 'activity', 'Mountain lakes with a famous reflection.', 45.995, 7.76, 'CHE', 'Zermatt, Switzerland', 'b', 1, 180,
  '["mid","mid","mid","low","low","mid","high","high","mid","low","low","high"]',
  '[{"min":-10,"max":-2},{"min":-9,"max":0},{"min":-6,"max":3},{"min":-3,"max":7},{"min":1,"max":12},{"min":5,"max":16},{"min":7,"max":19},{"min":7,"max":18},{"min":4,"max":14},{"min":0,"max":9},{"min":-5,"max":3},{"min":-9,"max":-1}]',
  '2030-01-01T00:00:00Z', '2030-01-01T00:00:00Z'),
 ('Diving with mantas', 'activity', 'Liveaboard trip.', -8.55, 119.48, 'IDN', 'Komodo, Indonesia', 'a', 0, 45,
  '["high","high","mid","mid","low","low","high","high","mid","mid","mid","high"]',
  '[{"min":24,"max":31},{"min":24,"max":31},{"min":24,"max":31},{"min":24,"max":32},{"min":23,"max":31},{"min":22,"max":30},{"min":21,"max":30},{"min":21,"max":30},{"min":22,"max":31},{"min":23,"max":32},{"min":24,"max":32},{"min":24,"max":31}]',
  '2030-01-01T00:00:00Z', '2030-01-01T00:00:00Z'),
 ('Sailing between atolls', 'activity', 'An idea at sea, outside any country polygon.', 4.2, 73.5, 'XXX', 'Open ocean', 'a', 0, 120, NULL, NULL,
  '2030-01-01T00:00:00Z', '2030-01-01T00:00:00Z');
