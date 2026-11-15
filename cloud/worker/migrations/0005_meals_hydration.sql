-- Food portions and the water tracker's signed adjustments.
CREATE TABLE IF NOT EXISTS meals (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  ts TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  grams REAL NOT NULL CHECK (grams BETWEEN 1 AND 2000),
  kcal REAL NOT NULL CHECK (kcal BETWEEN 0 AND 20000),
  protein REAL NOT NULL CHECK (protein BETWEEN 0 AND 2000),
  carbs REAL NOT NULL CHECK (carbs BETWEEN 0 AND 2000),
  fat REAL NOT NULL CHECK (fat BETWEEN 0 AND 2000)
);
CREATE INDEX IF NOT EXISTS idx_meals_user_ts ON meals(user_id, ts DESC);

CREATE TABLE IF NOT EXISTS hydration (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  ts TEXT NOT NULL,
  amount_ml INTEGER NOT NULL CHECK (amount_ml BETWEEN -10000 AND 10000 AND amount_ml <> 0)
);
CREATE INDEX IF NOT EXISTS idx_hydration_user_ts ON hydration(user_id, ts DESC);
