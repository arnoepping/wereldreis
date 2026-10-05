import { env } from "cloudflare:test";
import type { Env } from "../src/env";

export const testEnv = env as unknown as Env;

export async function resetDb(): Promise<void> {
  const db = testEnv.DB;
  await db.batch(
    ["notes", "ratings", "ideas", "pending", "settings", "users"].map((t) => db.prepare(`DELETE FROM ${t}`)),
  );
  await db.batch([
    db.prepare("INSERT INTO users (id, name, email, telegram_id) VALUES ('a', 'Traveller A', 'a@example.com', 1001)"),
    db.prepare("INSERT INTO users (id, name, email, telegram_id) VALUES ('b', 'Traveller B', 'b@example.com', 1002)"),
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('departure_date', '2030-01-01'), ('budget_eur', '50000'), ('flight_reserve_eur', '5000')",
    ),
  ]);
}
