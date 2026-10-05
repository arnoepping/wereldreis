import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testEnv } from "./helpers";
import * as db from "../src/db";
import { toDto } from "../src/serialize";
import { escapeHtml } from "../src/html";

const NOW = "2030-01-01T00:00:00.000Z";

describe("db", () => {
  beforeEach(resetDb);

  it("inserts and reads an idea with JSON fields", async () => {
    const climate = Array.from({ length: 12 }, () => ({ min: 20, max: 28 }));
    const id = await db.insertIdea(
      testEnv.DB,
      { title: "Komodo", kind: "activity", added_by: "a", price_season: Array(12).fill("mid"), climate },
      NOW,
    );
    const row = await db.getIdeaRow(testEnv.DB, id);
    expect(row?.title).toBe("Komodo");
    const dto = toDto(row!, {}, "a", "b", 0);
    expect(dto.months[0]).toEqual({ weather: "good", price: "mid", temp: { min: 20, max: 28 } });
    expect(dto.must_do).toBe(false);
  });

  it("updates only whitelisted fields and bumps updated_at", async () => {
    const id = await db.insertIdea(testEnv.DB, { title: "A", kind: "place", added_by: "a" }, NOW);
    await db.updateIdea(testEnv.DB, id, { title: "B", must_do: true }, "2030-02-01T00:00:00.000Z");
    const row = await db.getIdeaRow(testEnv.DB, id);
    expect([row?.title, row?.must_do, row?.updated_at]).toEqual(["B", 1, "2030-02-01T00:00:00.000Z"]);
  });

  it("stores ratings and serializes them blind", async () => {
    const id = await db.insertIdea(testEnv.DB, { title: "A", kind: "place", added_by: "a" }, NOW);
    await db.setRating(testEnv.DB, id, "b", 5);
    const stars = await db.starsFor(testEnv.DB, id);
    expect(toDto((await db.getIdeaRow(testEnv.DB, id))!, stars, "a", "b", 0).ratings).toEqual({
      mine: null,
      other: null,
      otherHidden: true,
    });
    await db.setRating(testEnv.DB, id, "a", 4);
    expect(toDto((await db.getIdeaRow(testEnv.DB, id))!, await db.starsFor(testEnv.DB, id), "a", "b", 0).ratings)
      .toEqual({ mine: 4, other: 5, otherHidden: false });
  });

  it("counts notes per idea and per country", async () => {
    const id = await db.insertIdea(testEnv.DB, { title: "A", kind: "place", added_by: "a" }, NOW);
    await db.addNote(testEnv.DB, { idea_id: id, country_iso: null, author: "a", body: "hi" }, NOW);
    await db.addNote(testEnv.DB, { idea_id: null, country_iso: "CHE", author: "b", body: "visa?" }, NOW);
    expect((await db.noteCountsByIdea(testEnv.DB)).get(id)).toBe(1);
    expect(await db.noteCountsByCountry(testEnv.DB)).toEqual({ CHE: 1 });
    expect((await db.listNotes(testEnv.DB, { country_iso: "CHE" }))[0].body).toBe("visa?");
  });

  it("deletes an idea together with its ratings and notes", async () => {
    const id = await db.insertIdea(testEnv.DB, { title: "A", kind: "place", added_by: "a" }, NOW);
    await db.setRating(testEnv.DB, id, "a", 3);
    await db.addNote(testEnv.DB, { idea_id: id, country_iso: null, author: "a", body: "hi" }, NOW);
    await db.deleteIdea(testEnv.DB, id);
    expect(await db.getIdeaRow(testEnv.DB, id)).toBeNull();
    expect((await db.noteCountsByIdea(testEnv.DB)).size).toBe(0);
  });

  it("link code works once and only before it expires", async () => {
    await db.setLinkCode(testEnv.DB, "a", "123456", "2030-01-01T00:15:00.000Z");
    expect(await db.consumeLinkCode(testEnv.DB, "123456", 5555, "2030-01-01T00:16:00.000Z")).toBeNull();
    await db.setLinkCode(testEnv.DB, "a", "123456", "2030-01-01T00:15:00.000Z");
    const u = await db.consumeLinkCode(testEnv.DB, "123456", 5555, "2030-01-01T00:05:00.000Z");
    expect(u?.id).toBe("a");
    expect((await db.userByTelegram(testEnv.DB, 5555))?.id).toBe("a");
    expect(await db.consumeLinkCode(testEnv.DB, "123456", 5555, "2030-01-01T00:06:00.000Z")).toBeNull();
  });

  it("reads settings with numeric values", async () => {
    expect(await db.getSettings(testEnv.DB)).toEqual({
      departure_date: "2030-01-01",
      budget_eur: 50000,
      flight_reserve_eur: 5000,
    });
  });

  it("escapes HTML", () => {
    expect(escapeHtml(`<b>"x" & 'y'</b>`)).toBe("&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;");
  });
});
