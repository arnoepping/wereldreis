CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  telegram_id INTEGER UNIQUE,
  link_code TEXT,
  link_code_expires TEXT
);

CREATE TABLE ideas (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('place','activity')),
  description TEXT,
  lat REAL,
  lng REAL,
  country_iso TEXT,
  region TEXT,
  source_url TEXT,
  photo_key TEXT,
  added_by TEXT NOT NULL REFERENCES users(id),
  must_do INTEGER NOT NULL DEFAULT 0,
  cost_pp_day INTEGER,
  season_basis TEXT NOT NULL DEFAULT 'weather' CHECK (season_basis IN ('weather','wildlife')),
  wildlife_months TEXT,
  price_season TEXT,
  climate TEXT,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','needs_details')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE ratings (
  idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  PRIMARY KEY (idea_id, user_id)
);

CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  idea_id INTEGER REFERENCES ideas(id) ON DELETE CASCADE,
  country_iso TEXT,
  author TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK ((idea_id IS NULL) <> (country_iso IS NULL))
);
CREATE INDEX notes_idea ON notes(idea_id);
CREATE INDEX notes_country ON notes(country_iso);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE pending (
  telegram_id INTEGER PRIMARY KEY,
  original TEXT NOT NULL,
  question TEXT NOT NULL,
  created_at TEXT NOT NULL
);
