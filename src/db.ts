import type { IdeaRow, NewIdea, Note, Settings, User } from "./types";

const USER_COLS = "id, name, email, telegram_id";

export async function getUsers(db: D1Database): Promise<User[]> {
  return (await db.prepare(`SELECT ${USER_COLS} FROM users ORDER BY id`).all<User>()).results;
}

export async function userByEmail(db: D1Database, email: string): Promise<User | null> {
  return db.prepare(`SELECT ${USER_COLS} FROM users WHERE lower(email) = lower(?)`).bind(email).first<User>();
}

export async function userByTelegram(db: D1Database, telegramId: number): Promise<User | null> {
  return db.prepare(`SELECT ${USER_COLS} FROM users WHERE telegram_id = ?`).bind(telegramId).first<User>();
}

export function otherOf(users: User[], meId: string): User {
  const other = users.find((u) => u.id !== meId);
  if (!other) throw new Error("Second traveller is missing; run the setup.");
  return other;
}

const json = (v: unknown) => (v == null ? null : JSON.stringify(v));

// Column name → how to turn a NewIdea value into a SQL value.
const IDEA_FIELDS: Record<keyof NewIdea, (v: never) => unknown> = {
  title: (v: string) => v,
  kind: (v: string) => v,
  added_by: (v: string) => v,
  description: (v: string | null) => v ?? null,
  lat: (v: number | null) => v ?? null,
  lng: (v: number | null) => v ?? null,
  country_iso: (v: string | null) => v ?? null,
  region: (v: string | null) => v ?? null,
  source_url: (v: string | null) => v ?? null,
  photo_key: (v: string | null) => v ?? null,
  must_do: (v: boolean) => (v ? 1 : 0),
  cost_pp_day: (v: number | null) => v ?? null,
  season_basis: (v: string) => v,
  wildlife_months: (v: number[] | null) => json(v),
  price_season: (v: string[] | null) => json(v),
  climate: (v: unknown) => json(v),
  status: (v: string) => v,
};

function columns(idea: Partial<NewIdea>): [string[], unknown[]] {
  const cols: string[] = [];
  const vals: unknown[] = [];
  for (const [key, encode] of Object.entries(IDEA_FIELDS)) {
    const value = idea[key as keyof NewIdea];
    if (value === undefined) continue;
    cols.push(key);
    vals.push(encode(value as never));
  }
  return [cols, vals];
}

export async function insertIdea(db: D1Database, idea: NewIdea, now: string): Promise<number> {
  const [cols, vals] = columns(idea);
  cols.push("created_at", "updated_at");
  vals.push(now, now);
  const sql = `INSERT INTO ideas (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")}) RETURNING id`;
  const row = await db.prepare(sql).bind(...vals).first<{ id: number }>();
  return row!.id;
}

export async function updateIdea(db: D1Database, id: number, patch: Partial<NewIdea>, now: string): Promise<void> {
  const [cols, vals] = columns(patch);
  cols.push("updated_at");
  vals.push(now);
  await db
    .prepare(`UPDATE ideas SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`)
    .bind(...vals, id)
    .run();
}

export async function deleteIdea(db: D1Database, id: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM notes WHERE idea_id = ?").bind(id),
    db.prepare("DELETE FROM ratings WHERE idea_id = ?").bind(id),
    db.prepare("DELETE FROM ideas WHERE id = ?").bind(id),
  ]);
}

export async function getIdeaRow(db: D1Database, id: number): Promise<IdeaRow | null> {
  return db.prepare("SELECT * FROM ideas WHERE id = ?").bind(id).first<IdeaRow>();
}

export async function listIdeaRows(db: D1Database): Promise<IdeaRow[]> {
  return (await db.prepare("SELECT * FROM ideas ORDER BY created_at DESC, id DESC").all<IdeaRow>()).results;
}

export async function starsFor(db: D1Database, ideaId: number): Promise<Record<string, number>> {
  const { results } = await db
    .prepare("SELECT user_id, stars FROM ratings WHERE idea_id = ?")
    .bind(ideaId)
    .all<{ user_id: string; stars: number }>();
  return Object.fromEntries(results.map((r) => [r.user_id, r.stars]));
}

export async function allStars(db: D1Database): Promise<Map<number, Record<string, number>>> {
  const { results } = await db
    .prepare("SELECT idea_id, user_id, stars FROM ratings")
    .all<{ idea_id: number; user_id: string; stars: number }>();
  const map = new Map<number, Record<string, number>>();
  for (const r of results) map.set(r.idea_id, { ...(map.get(r.idea_id) ?? {}), [r.user_id]: r.stars });
  return map;
}

export async function setRating(db: D1Database, ideaId: number, userId: string, stars: number): Promise<void> {
  await db
    .prepare(
      "INSERT INTO ratings (idea_id, user_id, stars) VALUES (?, ?, ?) ON CONFLICT (idea_id, user_id) DO UPDATE SET stars = excluded.stars",
    )
    .bind(ideaId, userId, stars)
    .run();
}

export async function noteCountsByIdea(db: D1Database): Promise<Map<number, number>> {
  const { results } = await db
    .prepare("SELECT idea_id, COUNT(*) AS n FROM notes WHERE idea_id IS NOT NULL GROUP BY idea_id")
    .all<{ idea_id: number; n: number }>();
  return new Map(results.map((r) => [r.idea_id, r.n]));
}

export async function noteCountsByCountry(db: D1Database): Promise<Record<string, number>> {
  const { results } = await db
    .prepare("SELECT country_iso, COUNT(*) AS n FROM notes WHERE country_iso IS NOT NULL GROUP BY country_iso")
    .all<{ country_iso: string; n: number }>();
  return Object.fromEntries(results.map((r) => [r.country_iso, r.n]));
}

export async function addNote(
  db: D1Database,
  n: { idea_id: number | null; country_iso: string | null; author: string; body: string },
  now: string,
): Promise<Note> {
  const note = await db
    .prepare("INSERT INTO notes (idea_id, country_iso, author, body, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *")
    .bind(n.idea_id, n.country_iso, n.author, n.body, now)
    .first<Note>();
  return note!;
}

export async function listNotes(db: D1Database, q: { idea_id?: number; country_iso?: string }): Promise<Note[]> {
  const stmt =
    q.idea_id != null
      ? db.prepare("SELECT * FROM notes WHERE idea_id = ? ORDER BY created_at, id").bind(q.idea_id)
      : db.prepare("SELECT * FROM notes WHERE country_iso = ? ORDER BY created_at, id").bind(q.country_iso ?? "");
  return (await stmt.all<Note>()).results;
}

export async function getSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const s = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return {
    departure_date: s.departure_date ?? null,
    budget_eur: Number(s.budget_eur ?? 0),
    flight_reserve_eur: Number(s.flight_reserve_eur ?? 0),
  };
}

export async function setSetting(
  db: D1Database,
  key: "departure_date" | "budget_eur" | "flight_reserve_eur",
  value: string,
): Promise<void> {
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}

export async function setUserName(db: D1Database, id: string, name: string): Promise<void> {
  await db.prepare("UPDATE users SET name = ? WHERE id = ?").bind(name, id).run();
}

export async function setLinkCode(db: D1Database, userId: string, code: string, expiresIso: string): Promise<void> {
  await db
    .prepare("UPDATE users SET link_code = ?, link_code_expires = ? WHERE id = ?")
    .bind(code, expiresIso, userId)
    .run();
}

export async function consumeLinkCode(
  db: D1Database,
  code: string,
  telegramId: number,
  nowIso: string,
): Promise<User | null> {
  const user = await db
    .prepare(`SELECT ${USER_COLS} FROM users WHERE link_code = ? AND link_code_expires > ?`)
    .bind(code, nowIso)
    .first<User>();
  if (!user) return null;
  await db.batch([
    db.prepare("UPDATE users SET telegram_id = NULL WHERE telegram_id = ?").bind(telegramId),
    db
      .prepare("UPDATE users SET telegram_id = ?, link_code = NULL, link_code_expires = NULL WHERE id = ?")
      .bind(telegramId, user.id),
  ]);
  return { ...user, telegram_id: telegramId };
}

export async function getPending(db: D1Database, telegramId: number) {
  return db
    .prepare("SELECT original, question FROM pending WHERE telegram_id = ?")
    .bind(telegramId)
    .first<{ original: string; question: string }>();
}

export async function setPending(db: D1Database, telegramId: number, original: string, question: string, now: string) {
  await db
    .prepare(
      "INSERT INTO pending (telegram_id, original, question, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (telegram_id) DO UPDATE SET original = excluded.original, question = excluded.question, created_at = excluded.created_at",
    )
    .bind(telegramId, original, question, now)
    .run();
}

export async function clearPending(db: D1Database, telegramId: number): Promise<void> {
  await db.prepare("DELETE FROM pending WHERE telegram_id = ?").bind(telegramId).run();
}
