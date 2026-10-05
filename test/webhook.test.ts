import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { handleUpdate, ideaSummary } from "../src/telegram/webhook";
import * as db from "../src/db";
import type { Deps } from "../src/deps";
import { resetDb, testEnv } from "./helpers";
import { KOMODO, stubDeps } from "./stubs";

let deps: ReturnType<typeof stubDeps>;
const msg = (from: number, text: string) => ({ update_id: 1, message: { message_id: 10, from: { id: from }, chat: { id: from }, text } });
const tap = (from: number, data: string) => ({
  update_id: 2,
  callback_query: { id: "cq", from: { id: from }, data, message: { message_id: 50, chat: { id: from } } },
});

describe("telegram webhook", () => {
  beforeEach(async () => {
    await resetDb();
    deps = stubDeps();
  });

  it("ignores unknown sender", async () => {
    await handleUpdate(msg(9999, "Komodo"), testEnv, deps as Deps);
    expect(deps.sent).toHaveLength(0);
    expect(await db.listIdeaRows(testEnv.DB)).toHaveLength(0);
  });

  it("links an account with a valid code", async () => {
    await db.setLinkCode(testEnv.DB, "b", "654321", "2030-01-01T00:15:00.000Z");
    await handleUpdate(msg(7777, "/start 654321"), testEnv, deps as Deps);
    expect((await db.userByTelegram(testEnv.DB, 7777))?.id).toBe("b");
    expect(deps.sent.at(-1)?.html).toContain("Linked");
  });

  it("link code cannot be reused", async () => {
    await db.setLinkCode(testEnv.DB, "b", "654321", "2030-01-01T00:15:00.000Z");
    await handleUpdate(msg(7777, "/start 654321"), testEnv, deps as Deps);
    await handleUpdate(msg(8888, "/start 654321"), testEnv, deps as Deps);
    expect(await db.userByTelegram(testEnv.DB, 8888)).toBeNull();
    expect(deps.sent.at(-1)?.html).toContain("invalid or expired");
  });

  it("expired code rejected", async () => {
    await db.setLinkCode(testEnv.DB, "b", "111111", "2029-12-31T23:59:00.000Z");
    await handleUpdate(msg(7777, "/start 111111"), testEnv, deps as Deps);
    expect(await db.userByTelegram(testEnv.DB, 7777)).toBeNull();
  });

  it("adds an idea and replies with a summary and rating buttons", async () => {
    await handleUpdate(msg(1001, "Komodo diving"), testEnv, deps as Deps);
    const [row] = await db.listIdeaRows(testEnv.DB);
    expect(row).toMatchObject({ title: "Diving with mantas", added_by: "a", country_iso: "IDN" });
    const reply = deps.sent.at(-1)!;
    expect(reply.html).toContain("Added: <b>Diving with mantas</b>");
    expect(reply.html).toContain("cheapest May–Jun");
    expect(reply.buttons?.[0].map((b) => b.callback_data)).toEqual([1, 2, 3, 4, 5].map((n) => `r:${row.id}:${n}`));
  });

  it("escapes HTML in Telegram summary", async () => {
    deps = stubDeps({ enrich: async () => ({ kind: "ideas", ideas: [{ ...KOMODO, title: "<b>x</b> & co" }] }) });
    await handleUpdate(msg(1001, "x"), testEnv, deps as Deps);
    expect(deps.sent.at(-1)!.html).toContain("&lt;b&gt;x&lt;/b&gt; &amp; co");
  });

  it("asks a clarifying question and combines the answer", async () => {
    const inputs: string[] = [];
    deps = stubDeps({
      enrich: async (input) => {
        inputs.push(input);
        return inputs.length === 1 ? { kind: "question", question: "Country or US state?" } : { kind: "ideas", ideas: [KOMODO] };
      },
    });
    await handleUpdate(msg(1001, "Georgia"), testEnv, deps as Deps);
    expect(deps.sent.at(-1)!.html).toBe("Country or US state?");
    await handleUpdate(msg(1001, "the country"), testEnv, deps as Deps);
    expect(inputs[1]).toContain("Georgia");
    expect(inputs[1]).toContain("the country");
    expect(await db.getPending(testEnv.DB, 1001)).toBeNull();
  });

  it("says so when nothing was recognised", async () => {
    deps = stubDeps({ enrich: async () => ({ kind: "ideas", ideas: [] }) });
    await handleUpdate(msg(1001, "hello"), testEnv, deps as Deps);
    expect(deps.sent.at(-1)!.html).toContain("couldn't find a place");
  });

  it("saves needs_details when enrichment fails", async () => {
    deps = stubDeps({ enrich: async () => Promise.reject(new Error("timeout")) });
    await handleUpdate(msg(1001, "Something in Peru"), testEnv, deps as Deps);
    expect((await db.listIdeaRows(testEnv.DB))[0].status).toBe("needs_details");
    expect(deps.sent.at(-1)!.html).toContain("couldn't look it up");
  });

  it("rating callback reveals other only after rating", async () => {
    await handleUpdate(msg(1001, "Komodo"), testEnv, deps as Deps);
    const [row] = await db.listIdeaRows(testEnv.DB);
    await handleUpdate(tap(1001, `r:${row.id}:4`), testEnv, deps as Deps);
    expect(deps.answers.at(-1)).toBe("You gave 4★. Traveller B hasn't rated it yet.");
    await handleUpdate(tap(1002, `r:${row.id}:5`), testEnv, deps as Deps);
    expect(deps.answers.at(-1)).toBe("You gave 5★. Traveller A: 4★.");
  });

  it("undo only works for the person who added it", async () => {
    await handleUpdate(msg(1001, "Komodo"), testEnv, deps as Deps);
    const [row] = await db.listIdeaRows(testEnv.DB);
    await handleUpdate(tap(1002, `u:${row.id}`), testEnv, deps as Deps);
    expect(await db.getIdeaRow(testEnv.DB, row.id)).not.toBeNull();
    await handleUpdate(tap(1001, `u:${row.id}`), testEnv, deps as Deps);
    expect(await db.getIdeaRow(testEnv.DB, row.id)).toBeNull();
  });

  it("undo is refused after 10 minutes", async () => {
    await handleUpdate(msg(1001, "Komodo"), testEnv, deps as Deps);
    const [row] = await db.listIdeaRows(testEnv.DB);
    const later = stubDeps({ now: () => new Date("2030-01-01T00:11:00.000Z") });
    await handleUpdate(tap(1001, `u:${row.id}`), testEnv, later as Deps);
    expect(await db.getIdeaRow(testEnv.DB, row.id)).not.toBeNull();
    expect(later.answers.at(-1)).toContain("delete it in the app");
  });

  it("rejects a wrong webhook secret", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("https://example.test/telegram", { method: "POST", body: "{}", headers: { "x-telegram-bot-api-secret-token": "nope" } }),
      testEnv,
      ctx,
    );
    expect(res.status).toBe(401);
  });

  it("webhook returns 200 before processing finishes", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request("https://example.test/telegram", {
        method: "POST",
        body: JSON.stringify({ update_id: 3 }),
        headers: { "x-telegram-bot-api-secret-token": "test-secret" },
      }),
      testEnv,
      ctx,
    );
    expect(res.status).toBe(200);
    await waitOnExecutionContext(ctx);
  });

  it("summary lists good months and cheapest months", () => {
    const climate = Array.from({ length: 12 }, (_, m) => (m >= 3 && m <= 10 ? { min: 20, max: 29 } : { min: 10, max: 20 }));
    const html = ideaSummary({
      id: 1, title: "T", kind: "place", description: null, lat: 0, lng: 0, country_iso: "IDN", region: "Komodo, Indonesia",
      source_url: null, photo_key: null, added_by: "a", must_do: 0, cost_pp_day: 45, season_basis: "weather",
      wildlife_months: null, price_season: JSON.stringify(KOMODO.price_season), climate: JSON.stringify(climate),
      status: "ready", created_at: "", updated_at: "",
    });
    expect(html).toBe("Added: <b>T</b> — Komodo, Indonesia · good Apr–Nov · cheapest May–Jun · ~€45/day");
  });
});
