import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createApi } from "../src/api";
import type { Deps } from "../src/deps";
import { resetDb, testEnv } from "./helpers";
import { stubDeps } from "./stubs";

let deps: ReturnType<typeof stubDeps>;

async function call(method: string, path: string, body?: unknown, user = "a@example.com") {
  const app = createApi(() => deps as Deps);
  const ctx = createExecutionContext();
  const res = await app.fetch(
    new Request(`https://example.test${path}`, {
      method,
      headers: { "content-type": "application/json", "x-dev-user": user },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    testEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return { status: res.status, body: res.status === 204 ? null : ((await res.json()) as any) };
}

describe("api", () => {
  beforeEach(async () => {
    await resetDb();
    deps = stubDeps();
  });

  it("returns me and the other traveller", async () => {
    const { body } = await call("GET", "/api/me");
    expect(body).toEqual({ id: "a", name: "Traveller A", other: { id: "b", name: "Traveller B" }, telegram_linked: true });
  });

  it("rejects unknown users", async () => {
    expect((await call("GET", "/api/me", undefined, "nobody@example.com")).status).toBe(401);
  });

  it("creates an idea by hand with climate data", async () => {
    const { status, body } = await call("POST", "/api/ideas", { title: "Lisbon", kind: "place", lat: 38.7, lng: -9.1 });
    expect(status).toBe(201);
    expect(body.months[0].weather).toBe("borderline"); // stub climate 24–31 °C
    expect(body.added_by).toBe("a");
  });

  it("creates ideas from text via enrichment", async () => {
    const { body } = await call("POST", "/api/ideas?enrich=1", { text: "Komodo diving" });
    expect(body.kind).toBe("ideas");
    expect(body.ideas[0]).toMatchObject({ title: "Diving with mantas", country_iso: "IDN", region: "Komodo, Indonesia" });
  });

  it("saves a needs_details idea when enrichment fails", async () => {
    deps = stubDeps({ enrich: async () => Promise.reject(new Error("timeout")) });
    const { body } = await call("POST", "/api/ideas?enrich=1", { text: "Something in Peru" });
    expect(body.kind).toBe("failed");
    expect(body.idea).toMatchObject({ title: "Something in Peru", status: "needs_details" });
  });

  it("hides other rating until I rate", async () => {
    const { body: idea } = await call("POST", "/api/ideas", { title: "X", kind: "place" });
    await call("PUT", `/api/ideas/${idea.id}/rating`, { stars: 5 }, "b@example.com");
    const list = await call("GET", "/api/ideas");
    expect(list.body.ideas[0].ratings).toEqual({ mine: null, other: null, otherHidden: true });
    const rated = await call("PUT", `/api/ideas/${idea.id}/rating`, { stars: 3 });
    expect(rated.body.ratings).toEqual({ mine: 3, other: 5, otherHidden: false });
  });

  it("rejects invalid star values", async () => {
    const { body: idea } = await call("POST", "/api/ideas", { title: "X", kind: "place" });
    expect((await call("PUT", `/api/ideas/${idea.id}/rating`, { stars: 6 })).status).toBe(400);
  });

  it("posts a note and pings the other traveller", async () => {
    const { body: idea } = await call("POST", "/api/ideas", { title: "Komodo <dive>", kind: "activity" });
    const { status } = await call("POST", "/api/notes", { idea_id: idea.id, body: "Liveaboard?" });
    expect(status).toBe(201);
    expect(deps.sent).toHaveLength(1);
    expect(deps.sent[0]).toMatchObject({ chatId: 1002 });
    expect(deps.sent[0].html).toBe("Traveller A on <b>Komodo &lt;dive&gt;</b>: Liveaboard?");
    const notes = await call("GET", `/api/notes?idea=${idea.id}`);
    expect(notes.body[0]).toMatchObject({ body: "Liveaboard?", author_name: "Traveller A" });
  });

  it("updates settings and names", async () => {
    const { body } = await call("PATCH", "/api/settings", { budget_eur: 70000, names: { b: "B2" } });
    expect(body).toMatchObject({ budget_eur: 70000, flight_reserve_eur: 5000, names: { a: "Traveller A", b: "B2" } });
  });

  it("computes the budget from ideas both love", async () => {
    const { body: idea } = await call("POST", "/api/ideas", { title: "X", kind: "place", country_iso: "IDN", cost_pp_day: 50 });
    await call("PUT", `/api/ideas/${idea.id}/rating`, { stars: 4 });
    expect((await call("GET", "/api/budget")).body.qualifying).toBe(0);
    await call("PUT", `/api/ideas/${idea.id}/rating`, { stars: 5 }, "b@example.com");
    expect((await call("GET", "/api/budget")).body).toMatchObject({ qualifying: 1, dailyForTwo: 100 });
  });

  it("issues a six-digit link code", async () => {
    const { body } = await call("POST", "/api/telegram-link-code");
    expect(body.code).toMatch(/^\d{6}$/);
  });

  it("marks a needs_details idea ready once it has a location and country", async () => {
    deps = stubDeps({ enrich: async () => Promise.reject(new Error("x")) });
    const { body } = await call("POST", "/api/ideas?enrich=1", { text: "Somewhere" });
    const { body: fixed } = await call("PATCH", `/api/ideas/${body.idea.id}`, { lat: 1, lng: 2, country_iso: "IDN" });
    expect(fixed.status).toBe("ready");
  });
});
