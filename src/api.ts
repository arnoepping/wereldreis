import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./env";
import type { Deps } from "./deps";
import type { User } from "./types";
import { currentUser } from "./auth";
import * as db from "./db";
import { toDto } from "./serialize";
import { budgetCheck } from "./logic/budget";
import { addIdeasFromText } from "./ideas-service";
import { escapeHtml } from "./html";

type AppEnv = { Bindings: Env; Variables: { user: User; other: User; deps: Deps } };
type Ctx = { env: Env; var: AppEnv["Variables"] };

const MonthList = z.array(z.number().int().min(1).max(12));
const IdeaFields = z.object({
  title: z.string().trim().min(1).max(120),
  kind: z.enum(["place", "activity"]),
  description: z.string().max(1000).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  country_iso: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
  region: z.string().max(120).nullable().optional(),
  source_url: z.string().url().nullable().optional(),
  must_do: z.boolean().optional(),
  cost_pp_day: z.number().int().min(0).max(5000).nullable().optional(),
  season_basis: z.enum(["weather", "wildlife"]).optional(),
  wildlife_months: MonthList.nullable().optional(),
  price_season: z.array(z.enum(["low", "mid", "high"])).length(12).nullable().optional(),
});
const SettingsPatch = z.object({
  departure_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  budget_eur: z.number().int().min(0).max(10_000_000).optional(),
  flight_reserve_eur: z.number().int().min(0).max(10_000_000).optional(),
  names: z.record(z.string(), z.string().trim().min(1).max(40)).optional(),
});
const NoteBody = z
  .object({
    idea_id: z.number().int().positive().optional(),
    country_iso: z.string().regex(/^[A-Z]{3}$/).optional(),
    label: z.string().max(120).optional(),
    body: z.string().trim().min(1).max(2000),
  })
  .refine((n) => (n.idea_id == null) !== (n.country_iso == null), "Give either idea_id or country_iso");

export function createApi(getDeps: (env: Env) => Deps) {
  const app = new Hono<AppEnv>().basePath("/api");

  app.use("*", async (c, next) => {
    const user = await currentUser(c.req.raw, c.env);
    if (!user) return c.json({ error: "Not signed in" }, 401);
    const users = await db.getUsers(c.env.DB);
    c.set("user", user);
    c.set("other", db.otherOf(users, user.id));
    c.set("deps", getDeps(c.env));
    await next();
  });

  const nowIso = (c: Ctx) => c.var.deps.now().toISOString();

  async function dto(c: Ctx, id: number) {
    const row = await db.getIdeaRow(c.env.DB, id);
    if (!row) return null;
    const notes = await db.noteCountsByIdea(c.env.DB);
    return toDto(row, await db.starsFor(c.env.DB, id), c.var.user.id, c.var.other.id, notes.get(id) ?? 0);
  }

  app.get("/me", (c) =>
    c.json({
      id: c.var.user.id,
      name: c.var.user.name,
      other: { id: c.var.other.id, name: c.var.other.name },
      telegram_linked: c.var.user.telegram_id != null,
    }),
  );

  app.post("/telegram-link-code", async (c) => {
    const digits = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
    const code = String(digits).padStart(6, "0");
    const expires = new Date(c.var.deps.now().getTime() + 15 * 60_000).toISOString();
    await db.setLinkCode(c.env.DB, c.var.user.id, code, expires);
    return c.json({ code, expires });
  });

  app.get("/ideas", async (c) => {
    const [rows, stars, notes, countryNotes] = await Promise.all([
      db.listIdeaRows(c.env.DB),
      db.allStars(c.env.DB),
      db.noteCountsByIdea(c.env.DB),
      db.noteCountsByCountry(c.env.DB),
    ]);
    return c.json({
      ideas: rows.map((r) => toDto(r, stars.get(r.id) ?? {}, c.var.user.id, c.var.other.id, notes.get(r.id) ?? 0)),
      country_note_counts: countryNotes,
    });
  });

  app.post("/ideas", async (c) => {
    if (c.req.query("enrich") === "1") {
      const { text } = z.object({ text: z.string().trim().min(1).max(2000) }).parse(await c.req.json());
      const result = await addIdeasFromText(c.env.DB, c.var.deps, c.var.user.id, text);
      if (result.kind === "ideas") {
        const ideas = await Promise.all(result.ids.map((id) => dto(c, id)));
        return c.json({ kind: "ideas", ideas }, 201);
      }
      if (result.kind === "failed") return c.json({ kind: "failed", idea: await dto(c, result.id) }, 201);
      return c.json(result);
    }
    const body = IdeaFields.parse(await c.req.json());
    const climate =
      body.lat != null && body.lng != null ? await c.var.deps.climate(body.lat, body.lng).catch(() => null) : null;
    const id = await db.insertIdea(c.env.DB, { ...body, climate, added_by: c.var.user.id }, nowIso(c));
    return c.json(await dto(c, id), 201);
  });

  app.patch("/ideas/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const row = await db.getIdeaRow(c.env.DB, id);
    if (!row) return c.json({ error: "Idea not found" }, 404);
    const patch = IdeaFields.partial().parse(await c.req.json());
    const lat = patch.lat !== undefined ? patch.lat : row.lat;
    const lng = patch.lng !== undefined ? patch.lng : row.lng;
    const moved = patch.lat !== undefined || patch.lng !== undefined;
    const extra: { climate?: Awaited<ReturnType<Deps["climate"]>>; status?: "ready" } = {};
    if ((moved || row.climate == null) && lat != null && lng != null) {
      extra.climate = await c.var.deps.climate(lat, lng).catch(() => null);
    }
    const complete = (patch.title ?? row.title) && lat != null && lng != null && (patch.country_iso ?? row.country_iso);
    if (row.status === "needs_details" && complete) extra.status = "ready";
    await db.updateIdea(c.env.DB, id, { ...patch, ...extra }, nowIso(c));
    return c.json(await dto(c, id));
  });

  app.delete("/ideas/:id", async (c) => {
    await db.deleteIdea(c.env.DB, Number(c.req.param("id")));
    return c.body(null, 204);
  });

  app.put("/ideas/:id/rating", async (c) => {
    const id = Number(c.req.param("id"));
    if (!(await db.getIdeaRow(c.env.DB, id))) return c.json({ error: "Idea not found" }, 404);
    const { stars } = z.object({ stars: z.number().int().min(1).max(5) }).parse(await c.req.json());
    await db.setRating(c.env.DB, id, c.var.user.id, stars);
    return c.json(await dto(c, id));
  });

  app.get("/notes", async (c) => {
    const idea = c.req.query("idea");
    const country = c.req.query("country");
    const users = await db.getUsers(c.env.DB);
    const names = Object.fromEntries(users.map((u) => [u.id, u.name]));
    const notes = await db.listNotes(c.env.DB, idea ? { idea_id: Number(idea) } : { country_iso: country ?? "" });
    return c.json(notes.map((n) => ({ ...n, author_name: names[n.author] ?? n.author })));
  });

  app.post("/notes", async (c) => {
    const body = NoteBody.parse(await c.req.json());
    let label = body.label ?? body.country_iso ?? "";
    let link = `${c.env.APP_URL}/#country-${body.country_iso}`;
    if (body.idea_id != null) {
      const row = await db.getIdeaRow(c.env.DB, body.idea_id);
      if (!row) return c.json({ error: "Idea not found" }, 404);
      label = row.title;
      link = `${c.env.APP_URL}/#idea-${row.id}`;
    }
    const note = await db.addNote(
      c.env.DB,
      { idea_id: body.idea_id ?? null, country_iso: body.country_iso ?? null, author: c.var.user.id, body: body.body },
      nowIso(c),
    );
    const other = c.var.other;
    if (other.telegram_id != null) {
      const html = `${escapeHtml(c.var.user.name)} on <b>${escapeHtml(label)}</b>: ${escapeHtml(body.body)}`;
      c.executionCtx.waitUntil(
        c.var.deps.telegram
          .sendMessage(other.telegram_id, html, { buttons: [[{ text: "Open", url: link }]] })
          .catch((err) => console.error("note ping failed", err)),
      );
    }
    return c.json({ ...note, author_name: c.var.user.name }, 201);
  });

  app.get("/settings", async (c) => {
    const users = await db.getUsers(c.env.DB);
    return c.json({ ...(await db.getSettings(c.env.DB)), names: Object.fromEntries(users.map((u) => [u.id, u.name])) });
  });

  app.patch("/settings", async (c) => {
    const p = SettingsPatch.parse(await c.req.json());
    if (p.departure_date) await db.setSetting(c.env.DB, "departure_date", p.departure_date);
    if (p.budget_eur != null) await db.setSetting(c.env.DB, "budget_eur", String(p.budget_eur));
    if (p.flight_reserve_eur != null) await db.setSetting(c.env.DB, "flight_reserve_eur", String(p.flight_reserve_eur));
    const users = await db.getUsers(c.env.DB);
    for (const [id, name] of Object.entries(p.names ?? {})) {
      if (users.some((u) => u.id === id)) await db.setUserName(c.env.DB, id, name);
    }
    const fresh = await db.getUsers(c.env.DB);
    return c.json({ ...(await db.getSettings(c.env.DB)), names: Object.fromEntries(fresh.map((u) => [u.id, u.name])) });
  });

  app.get("/budget", async (c) => {
    const [rows, stars, settings] = await Promise.all([
      db.listIdeaRows(c.env.DB),
      db.allStars(c.env.DB),
      db.getSettings(c.env.DB),
    ]);
    const inputs = rows.map((r) => ({ country_iso: r.country_iso, cost_pp_day: r.cost_pp_day, stars: stars.get(r.id) ?? {} }));
    return c.json(budgetCheck(inputs, [c.var.user.id, c.var.other.id], settings.budget_eur, settings.flight_reserve_eur));
  });

  app.get("/photos/:key{.+}", async (c) => {
    const obj = await c.env.PHOTOS.get(decodeURIComponent(c.req.param("key")));
    if (!obj) return c.json({ error: "Photo not found" }, 404);
    return new Response(obj.body, {
      headers: { "content-type": obj.httpMetadata?.contentType ?? "image/jpeg", "cache-control": "private, max-age=86400" },
    });
  });

  app.onError((err, c) => {
    if (err instanceof z.ZodError) return c.json({ error: err.issues.map((i) => i.message).join("; ") }, 400);
    console.error(err);
    return c.json({ error: "Something went wrong on the server." }, 500);
  });

  return app;
}
