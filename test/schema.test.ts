import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testEnv } from "./helpers";

describe("schema", () => {
  beforeEach(resetDb);

  it("seeds two travellers", async () => {
    const { results } = await testEnv.DB.prepare("SELECT id FROM users ORDER BY id").all();
    expect(results.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("rejects a note attached to neither an idea nor a country", async () => {
    await expect(
      testEnv.DB.prepare("INSERT INTO notes (author, body, created_at) VALUES ('a', 'x', '2030-01-01')").run(),
    ).rejects.toThrow();
  });

  it("rejects a rating outside 1–5", async () => {
    await testEnv.DB.prepare(
      "INSERT INTO ideas (id, title, kind, added_by, created_at, updated_at) VALUES (1, 'X', 'place', 'a', 'now', 'now')",
    ).run();
    await expect(
      testEnv.DB.prepare("INSERT INTO ratings (idea_id, user_id, stars) VALUES (1, 'a', 6)").run(),
    ).rejects.toThrow();
  });
});
