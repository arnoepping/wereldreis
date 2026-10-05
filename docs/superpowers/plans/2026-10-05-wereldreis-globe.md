# Wereldreis Globe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private, two-person trip-planning globe where ideas arrive via a Telegram bot, get AI-enriched (location, best months, price season, cost), and can be rated blind, discussed in notes, and summarised in a rough budget check.

**Architecture:** One Cloudflare Worker serves the static globe app (`app/`, plain ES modules + MapLibre GL) and a Hono API (`/api/*`) plus the Telegram webhook (`/telegram`). Data lives in D1, photos in R2. Login is Cloudflare Access. External services (Claude, Open-Meteo, Telegram) sit behind a `Deps` interface so all Worker logic is tested with stubs inside the Workers runtime.

**Tech Stack:** TypeScript, Cloudflare Workers + static assets, D1, R2, Hono 4, jose 6, zod 4, `@anthropic-ai/sdk` (0.131+), Vitest 4 + `@cloudflare/vitest-pool-workers` 0.22, MapLibre GL JS 5.6, Python 3 + Pillow/numpy (one-off map-data build).

**Spec:** `docs/superpowers/specs/2026-10-05-wereldreis-globe-design.md`

## Global Constraints

- The repository is public: **no personal data** in any committed file (names, emails, Telegram IDs, departure date, budget figures, ideas, notes). Use `Traveller A`/`Traveller B`, `a@example.com`/`b@example.com`, `2030-01-01`, `50000`, `5000` in tests, fixtures and docs.
- Secrets only in Cloudflare secrets / `.dev.vars` (git-ignored): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `APP_URL`.
- Weather rule, verbatim: **Good** min ≥ 16 °C and max ≤ 30 °C; **Borderline** not good but min ≥ 14 °C and max ≤ 32 °C; **Poor** otherwise; **Unknown** without data.
- Blind ratings: the other traveller's stars are returned only if the requester has rated the idea.
- Budget: ideas both rated ≥ 4★; per-country median `cost_pp_day`; mean of countries × 2; months = (budget − flight reserve) / (daily × 30.4), one decimal.
- Telegram "Undo": 10 minutes, only the traveller who added the idea.
- Link codes: one-time, valid 15 minutes.
- Enrichment model: `claude-opus-5-5`, `output_config.format` JSON schema, server-side `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`).
- Satellite tiles: `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg` (note `{y}` before `{x}`), cross-fade from relief between zoom 5 and 6. Attribution: "Relief: Natural Earth · Satellite: Sentinel-2 cloudless 2024 by EOX, contains modified Copernicus Sentinel data".
- All user-provided text is escaped before going into HTML (app) or Telegram `parse_mode: "HTML"` messages.

## Review Focus

1. **Slow AI vs Telegram:** the webhook must answer `200` immediately and do the work in `ctx.waitUntil`; the Claude call is aborted after 25 s so a slow call ends as a "needs details" idea instead of vanishing. Tests: Task 6 "webhook returns 200 before processing finishes" and Task 5 "timeout becomes needs_details".
2. **Blind-rating leaks through side doors:** `/api/ideas`, the Telegram rating callback and the budget endpoint must never reveal the other's stars before you rate. Tests: Task 4 "hides other rating until I rate" and Task 6 "rating callback reveals other only after rating".
3. **HTML injection:** titles/notes containing `<`, `&` must render as text in the app and in Telegram HTML messages. Test: Task 6 "escapes HTML in Telegram summary"; app uses `esc()` everywhere (Task 9 manual check with a title `<b>x</b> & co`).
4. **Ideas outside any country polygon** (at sea, small islands, `country_iso` not in map data): the pin still shows and opening it flies to the pin instead of breaking the drill-down. Check: Task 8 manual step with a fixture idea at sea.
5. **Unknown senders and replayed codes:** messages from unlinked Telegram IDs are ignored; a link code works once and expires after 15 minutes. Tests: Task 6 "ignores unknown sender", "link code cannot be reused", "expired code rejected".

---

## File Structure

```
package.json, tsconfig.json, wrangler.jsonc, vitest.config.ts, .dev.vars.example, .gitignore
migrations/0001_init.sql            schema
src/env.ts                          Env bindings type
src/index.ts                        Worker entry: routes /telegram, /api/*, static assets
src/deps.ts                         Deps interface + production wiring
src/types.ts                        row + DTO types
src/db.ts                           all D1 queries
src/serialize.ts                    IdeaRow → IdeaDto (months, blind ratings)
src/auth.ts                         Access JWT / dev user → User
src/api.ts                          Hono routes
src/ideas-service.ts                text → enriched ideas → stored (shared by bot and API)
src/logic/weather.ts                weather marks + monthly averages
src/logic/budget.ts                 budget check
src/logic/ratings.ts                blind rating view
src/logic/months.ts                 month-range text ("Apr–Nov")
src/climate.ts                      Open-Meteo client
src/enrich.ts                       Claude enrichment + output validation
src/link-preview.ts                 page title/description fetch
src/telegram/api.ts                 Telegram Bot API client
src/telegram/webhook.ts             update handling
src/html.ts                         escapeHtml
test/setup.ts, test/helpers.ts      migrations + seed + stub deps
test/*.test.ts                      tests per module
test/fixtures/dev-seed.sql          fake local data
scripts/build-map-data.py           Natural Earth → app/data + app/tiles
scripts/setup.mjs                   one-time Cloudflare/Telegram setup
app/index.html, app/css/app.css
app/js/{main,api,state,geo,globe,months,panel,card,forms,util}.js
app/data/…, app/tiles/…             generated map data
docs/setup.md                       setup guide for the travellers
```

---

### Task 0: Repository hygiene and GitHub (with the user)

**Files:**
- Modify: git config (repo-local), `.gitignore`

**Interfaces:** none.

- [ ] **Step 1: Use a GitHub no-reply address for this repo**

Ask the user for their GitHub username. Then (replace `ID+USERNAME` with the value shown at github.com/settings/emails under "Keep my email addresses private"):

```bash
git config user.name "USERNAME"
git config user.email "ID+USERNAME@users.noreply.github.com"
git commit --amend --reset-author --no-edit
git log --format='%an <%ae>' | sort -u
```
Expected: only the no-reply identity is listed.

- [ ] **Step 2: Extend `.gitignore`**

```
node_modules/
.wrangler/
.dev.vars
*.local.*
.DS_Store
.venv/
scripts/.cache/
```

- [ ] **Step 3: Create the public repo and push (user must be logged in: `gh auth status`)**

```bash
git add .gitignore && git commit -m "chore: ignore local and generated files"
gh repo create wereldreis --public --source . --push --description "A two-person trip-planning globe"
```
Expected: repo URL printed; `git log origin/main` matches local.

---

### Task 1: Worker scaffold, schema and test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `wrangler.jsonc`, `vitest.config.ts`, `.dev.vars.example`, `migrations/0001_init.sql`, `src/env.ts`, `src/index.ts`, `test/setup.ts`, `test/helpers.ts`, `test/schema.test.ts`, `app/index.html` (placeholder)

**Interfaces:**
- Produces: `Env` (src/env.ts); `testEnv`, `resetDb()` (test/helpers.ts); D1 tables per spec §6.

- [ ] **Step 1: Create `package.json` and install**

```json
{
  "name": "wereldreis",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "deploy": "wrangler deploy",
    "db:migrate:local": "wrangler d1 migrations apply wereldreis --local",
    "db:seed:local": "wrangler d1 execute wereldreis --local --file=test/fixtures/dev-seed.sql",
    "db:migrate:remote": "wrangler d1 migrations apply wereldreis --remote",
    "setup": "node scripts/setup.mjs"
  }
}
```

```bash
npm install hono jose zod @anthropic-ai/sdk
npm install -D wrangler "vitest@^4.1" @cloudflare/vitest-pool-workers typescript @cloudflare/workers-types
```

- [ ] **Step 2: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers/types"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: `wrangler.jsonc`** (the `database_id` is filled in by `npm run setup -- cloudflare` in Task 10; a zero UUID works locally)

```jsonc
{
  "name": "wereldreis",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./app",
    "binding": "ASSETS",
    "run_worker_first": ["/api/*", "/telegram"]
  },
  "d1_databases": [
    { "binding": "DB", "database_name": "wereldreis", "database_id": "00000000-0000-0000-0000-000000000000", "migrations_dir": "migrations" }
  ],
  "r2_buckets": [{ "binding": "PHOTOS", "bucket_name": "wereldreis-photos" }],
  "vars": { "APP_ENV": "production" }
}
```

- [ ] **Step 4: `.dev.vars.example`** (copy to `.dev.vars` for local dev)

```
APP_ENV=dev
DEV_USER_EMAIL=a@example.com
APP_URL=http://localhost:8787
TELEGRAM_BOT_TOKEN=dev
TELEGRAM_WEBHOOK_SECRET=dev-secret
ANTHROPIC_API_KEY=sk-ant-dev
ACCESS_TEAM_DOMAIN=dev.cloudflareaccess.com
ACCESS_AUD=dev
```

- [ ] **Step 5: `migrations/0001_init.sql`**

```sql
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
```

- [ ] **Step 6: `src/env.ts`**

```ts
export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  APP_ENV: string;
  APP_URL: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  ANTHROPIC_API_KEY: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  DEV_USER_EMAIL?: string;
}
```

- [ ] **Step 7: Minimal `src/index.ts` and placeholder `app/index.html`**

```ts
import type { Env } from "./env";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
```

`app/index.html`:
```html
<!doctype html><title>Wereldreis</title><p>Coming soon.</p>
```

- [ ] **Step 8: `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            APP_ENV: "test",
            APP_URL: "https://example.test",
            TELEGRAM_BOT_TOKEN: "test-token",
            TELEGRAM_WEBHOOK_SECRET: "test-secret",
            ANTHROPIC_API_KEY: "test-key",
            ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com",
            ACCESS_AUD: "test-aud",
            DEV_USER_EMAIL: "a@example.com",
          },
        },
      }),
    ],
    test: { setupFiles: ["./test/setup.ts"] },
  };
});
```

- [ ] **Step 9: `test/setup.ts` and `test/helpers.ts`**

```ts
// test/setup.ts
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";

beforeAll(async () => {
  const e = env as unknown as { DB: D1Database; TEST_MIGRATIONS: D1Migration[] };
  await applyD1Migrations(e.DB, e.TEST_MIGRATIONS);
});
```

```ts
// test/helpers.ts
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
```

- [ ] **Step 10: Write the schema test `test/schema.test.ts`**

```ts
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
```

- [ ] **Step 11: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: 3 tests PASS, no type errors.

- [ ] **Step 12: Commit**

```bash
git add -A && git commit -m "feat: worker scaffold, D1 schema and test harness"
```

---

### Task 2: Pure logic — weather, months, ratings, budget

**Files:**
- Create: `src/logic/weather.ts`, `src/logic/months.ts`, `src/logic/ratings.ts`, `src/logic/budget.ts`
- Test: `test/logic.test.ts`

**Interfaces:**
- Produces:
  - `type MonthTemp = { min: number; max: number }`
  - `type WeatherMark = "good" | "borderline" | "poor" | "unknown"`
  - `classifyMonth(t: MonthTemp | null | undefined): WeatherMark`
  - `monthMarks(i: { season_basis: "weather" | "wildlife"; climate: (MonthTemp | null)[] | null; wildlife_months: number[] | null }): WeatherMark[]` (length 12)
  - `monthlyAverages(times: string[], mins: (number | null)[], maxs: (number | null)[]): (MonthTemp | null)[]`
  - `monthRanges(months: number[]): string` — e.g. `[4,5,6,7,8,9,10,11]` → `"Apr–Nov"`, `[11,12,1,2,3]` → `"Nov–Mar"`, `[4,11]` → `"Apr, Nov"`, `[]` → `""`
  - `type RatingView = { mine: number | null; other: number | null; otherHidden: boolean }`; `viewRatings(stars: Record<string, number>, me: string, other: string): RatingView`
  - `type BudgetInput = { country_iso: string | null; cost_pp_day: number | null; stars: Record<string, number> }`
  - `type BudgetResult = { qualifying: number; dailyForTwo: number | null; months: number | null; budget: number; flightReserve: number }`
  - `budgetCheck(ideas: BudgetInput[], userIds: [string, string], budget: number, flightReserve: number): BudgetResult`

- [ ] **Step 1: Write the failing tests `test/logic.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { classifyMonth, monthMarks, monthlyAverages } from "../src/logic/weather";
import { monthRanges } from "../src/logic/months";
import { viewRatings } from "../src/logic/ratings";
import { budgetCheck } from "../src/logic/budget";

describe("classifyMonth", () => {
  it.each([
    [{ min: 16, max: 30 }, "good"],
    [{ min: 22, max: 28 }, "good"],
    [{ min: 15.9, max: 30 }, "borderline"],
    [{ min: 16, max: 30.1 }, "borderline"],
    [{ min: 14, max: 32 }, "borderline"],
    [{ min: 13.9, max: 25 }, "poor"],
    [{ min: 20, max: 32.1 }, "poor"],
    [null, "unknown"],
    [{ min: Number.NaN, max: 20 }, "unknown"],
  ] as const)("%j → %s", (t, mark) => {
    expect(classifyMonth(t as never)).toBe(mark);
  });
});

describe("monthMarks", () => {
  it("uses sighting months for wildlife ideas", () => {
    const marks = monthMarks({ season_basis: "wildlife", climate: null, wildlife_months: [7, 8, 9] });
    expect(marks[6]).toBe("good");
    expect(marks[0]).toBe("poor");
  });
  it("is unknown everywhere without climate data", () => {
    expect(new Set(monthMarks({ season_basis: "weather", climate: null, wildlife_months: null }))).toEqual(
      new Set(["unknown"]),
    );
  });
});

describe("monthlyAverages", () => {
  it("averages per calendar month and skips nulls", () => {
    const avg = monthlyAverages(
      ["2024-01-01", "2024-01-02", "2025-01-01", "2024-02-01"],
      [10, 12, null, 5],
      [20, 22, 30, 15],
    );
    expect(avg[0]).toEqual({ min: 11, max: 21 });
    expect(avg[1]).toEqual({ min: 5, max: 15 });
    expect(avg[2]).toBeNull();
  });
});

describe("monthRanges", () => {
  it.each([
    [[4, 5, 6, 7, 8, 9, 10, 11], "Apr–Nov"],
    [[11, 12, 1, 2, 3], "Nov–Mar"],
    [[4, 11], "Apr, Nov"],
    [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], "all year"],
    [[], ""],
  ])("%j → %s", (months, text) => {
    expect(monthRanges(months)).toBe(text);
  });
});

describe("viewRatings", () => {
  it("hides the other rating until I rate", () => {
    expect(viewRatings({ b: 5 }, "a", "b")).toEqual({ mine: null, other: null, otherHidden: true });
  });
  it("reveals the other rating once I rated", () => {
    expect(viewRatings({ a: 3, b: 5 }, "a", "b")).toEqual({ mine: 3, other: 5, otherHidden: false });
  });
  it("is not hidden when nobody rated", () => {
    expect(viewRatings({}, "a", "b")).toEqual({ mine: null, other: null, otherHidden: false });
  });
});

describe("budgetCheck", () => {
  const loved = { a: 5, b: 4 };
  it("uses per-country medians of ideas both rated ≥ 4", () => {
    const r = budgetCheck(
      [
        { country_iso: "CHE", cost_pp_day: 180, stars: loved },
        { country_iso: "CHE", cost_pp_day: 170, stars: loved },
        { country_iso: "IDN", cost_pp_day: 45, stars: { a: 5, b: 5 } },
        { country_iso: "JPN", cost_pp_day: 300, stars: { a: 5, b: 3 } },
        { country_iso: "PRT", cost_pp_day: null, stars: loved },
      ],
      ["a", "b"],
      50000,
      5000,
    );
    // CHE median 175, IDN 45 → mean 110 → ×2 = 220/day; 45000 / (220 × 30.4) = 6.73
    expect(r).toEqual({ qualifying: 4, dailyForTwo: 220, months: 6.7, budget: 50000, flightReserve: 5000 });
  });
  it("returns nulls when nothing qualifies", () => {
    expect(budgetCheck([], ["a", "b"], 50000, 5000)).toEqual({
      qualifying: 0,
      dailyForTwo: null,
      months: null,
      budget: 50000,
      flightReserve: 5000,
    });
  });
  it("returns null months when the daily cost is zero", () => {
    const r = budgetCheck([{ country_iso: "XXX", cost_pp_day: 0, stars: loved }], ["a", "b"], 50000, 5000);
    expect(r.months).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/logic.test.ts`
Expected: FAIL, cannot resolve `../src/logic/weather`.

- [ ] **Step 3: Implement `src/logic/weather.ts`**

```ts
export type MonthTemp = { min: number; max: number };
export type WeatherMark = "good" | "borderline" | "poor" | "unknown";

export function classifyMonth(t: MonthTemp | null | undefined): WeatherMark {
  if (!t || !Number.isFinite(t.min) || !Number.isFinite(t.max)) return "unknown";
  if (t.min >= 16 && t.max <= 30) return "good";
  if (t.min >= 14 && t.max <= 32) return "borderline";
  return "poor";
}

export function monthMarks(i: {
  season_basis: "weather" | "wildlife";
  climate: (MonthTemp | null)[] | null;
  wildlife_months: number[] | null;
}): WeatherMark[] {
  return Array.from({ length: 12 }, (_, m) => {
    if (i.season_basis === "wildlife") {
      if (!i.wildlife_months) return "unknown";
      return i.wildlife_months.includes(m + 1) ? "good" : "poor";
    }
    return classifyMonth(i.climate?.[m]);
  });
}

const round1 = (x: number) => Math.round(x * 10) / 10;

export function monthlyAverages(
  times: string[],
  mins: (number | null)[],
  maxs: (number | null)[],
): (MonthTemp | null)[] {
  const acc = Array.from({ length: 12 }, () => ({ min: 0, max: 0, n: 0 }));
  times.forEach((t, i) => {
    const lo = mins[i];
    const hi = maxs[i];
    if (lo == null || hi == null) return;
    const m = Number(t.slice(5, 7)) - 1;
    acc[m].min += lo;
    acc[m].max += hi;
    acc[m].n += 1;
  });
  return acc.map((a) => (a.n ? { min: round1(a.min / a.n), max: round1(a.max / a.n) } : null));
}
```

- [ ] **Step 4: Implement `src/logic/months.ts`**

```ts
const NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthRanges(months: number[]): string {
  const set = new Set(months.filter((m) => m >= 1 && m <= 12));
  if (set.size === 0) return "";
  if (set.size === 12) return "all year";
  // Start at a month whose predecessor is not included, so ranges can wrap over December.
  let start = 1;
  while (!(set.has(start) && !set.has(start === 1 ? 12 : start - 1))) start = (start % 12) + 1;
  const runs: [number, number][] = [];
  let m = start;
  for (let step = 0; step < 12; step++, m = (m % 12) + 1) {
    if (!set.has(m)) continue;
    const prev = m === 1 ? 12 : m - 1;
    if (runs.length && runs[runs.length - 1][1] === prev && set.has(prev)) runs[runs.length - 1][1] = m;
    else runs.push([m, m]);
  }
  return runs.map(([a, b]) => (a === b ? NAMES[a - 1] : `${NAMES[a - 1]}–${NAMES[b - 1]}`)).join(", ");
}
```

- [ ] **Step 5: Implement `src/logic/ratings.ts`**

```ts
export type RatingView = { mine: number | null; other: number | null; otherHidden: boolean };

export function viewRatings(stars: Record<string, number>, me: string, other: string): RatingView {
  const mine = stars[me] ?? null;
  const theirs = stars[other] ?? null;
  if (mine === null) return { mine: null, other: null, otherHidden: theirs !== null };
  return { mine, other: theirs, otherHidden: false };
}
```

- [ ] **Step 6: Implement `src/logic/budget.ts`**

```ts
export type BudgetInput = { country_iso: string | null; cost_pp_day: number | null; stars: Record<string, number> };
export type BudgetResult = {
  qualifying: number;
  dailyForTwo: number | null;
  months: number | null;
  budget: number;
  flightReserve: number;
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function budgetCheck(
  ideas: BudgetInput[],
  userIds: [string, string],
  budget: number,
  flightReserve: number,
): BudgetResult {
  const loved = ideas.filter((i) => userIds.every((u) => (i.stars[u] ?? 0) >= 4));
  const byCountry = new Map<string, number[]>();
  for (const i of loved) {
    if (i.cost_pp_day == null || !i.country_iso) continue;
    const list = byCountry.get(i.country_iso) ?? [];
    list.push(i.cost_pp_day);
    byCountry.set(i.country_iso, list);
  }
  const base = { qualifying: loved.length, budget, flightReserve };
  if (byCountry.size === 0) return { ...base, dailyForTwo: null, months: null };
  const perCountry = [...byCountry.values()].map(median);
  const daily = (perCountry.reduce((a, b) => a + b, 0) / perCountry.length) * 2;
  if (daily <= 0) return { ...base, dailyForTwo: Math.round(daily), months: null };
  const months = Math.round((Math.max(0, budget - flightReserve) / (daily * 30.4)) * 10) / 10;
  return { ...base, dailyForTwo: Math.round(daily), months };
}
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run test/logic.test.ts`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: weather, month-range, blind-rating and budget logic"
```

---

### Task 3: Database access and idea serialization

**Files:**
- Create: `src/types.ts`, `src/db.ts`, `src/serialize.ts`, `src/html.ts`
- Test: `test/db.test.ts`

**Interfaces:**
- Consumes: Task 2 logic.
- Produces (`src/types.ts`):

```ts
import type { MonthTemp, WeatherMark } from "./logic/weather";
import type { RatingView } from "./logic/ratings";

export type User = { id: string; name: string; email: string; telegram_id: number | null };
export type PriceSeason = "low" | "mid" | "high";
export type Kind = "place" | "activity";
export type SeasonBasis = "weather" | "wildlife";
export type Status = "ready" | "needs_details";

export type IdeaRow = {
  id: number; title: string; kind: Kind; description: string | null;
  lat: number | null; lng: number | null; country_iso: string | null; region: string | null;
  source_url: string | null; photo_key: string | null; added_by: string; must_do: number;
  cost_pp_day: number | null; season_basis: SeasonBasis; wildlife_months: string | null;
  price_season: string | null; climate: string | null; status: Status;
  created_at: string; updated_at: string;
};

export type NewIdea = {
  title: string; kind: Kind; added_by: string;
  description?: string | null; lat?: number | null; lng?: number | null;
  country_iso?: string | null; region?: string | null; source_url?: string | null;
  photo_key?: string | null; must_do?: boolean; cost_pp_day?: number | null;
  season_basis?: SeasonBasis; wildlife_months?: number[] | null;
  price_season?: PriceSeason[] | null; climate?: (MonthTemp | null)[] | null; status?: Status;
};

export type MonthCell = { weather: WeatherMark; price: PriceSeason | null; temp: MonthTemp | null };

export type IdeaDto = {
  id: number; title: string; kind: Kind; description: string | null;
  lat: number | null; lng: number | null; country_iso: string | null; region: string | null;
  source_url: string | null; photo_url: string | null; added_by: string; must_do: boolean;
  cost_pp_day: number | null; season_basis: SeasonBasis; wildlife_months: number[] | null;
  price_season: PriceSeason[] | null; months: MonthCell[]; status: Status;
  ratings: RatingView; note_count: number; created_at: string;
};

export type Note = { id: number; idea_id: number | null; country_iso: string | null; author: string; body: string; created_at: string };
export type Settings = { departure_date: string | null; budget_eur: number; flight_reserve_eur: number };
```

- Produces (`src/db.ts`) — exact signatures:
  - `getUsers(db: D1Database): Promise<User[]>` (ordered by id)
  - `userByEmail(db, email: string): Promise<User | null>` (case-insensitive)
  - `userByTelegram(db, telegramId: number): Promise<User | null>`
  - `otherOf(users: User[], meId: string): User`
  - `insertIdea(db, idea: NewIdea, now: string): Promise<number>`
  - `updateIdea(db, id: number, patch: Partial<NewIdea>, now: string): Promise<void>`
  - `deleteIdea(db, id: number): Promise<void>`
  - `getIdeaRow(db, id: number): Promise<IdeaRow | null>`
  - `listIdeaRows(db): Promise<IdeaRow[]>`
  - `starsFor(db, ideaId: number): Promise<Record<string, number>>`
  - `allStars(db): Promise<Map<number, Record<string, number>>>`
  - `setRating(db, ideaId: number, userId: string, stars: number): Promise<void>`
  - `noteCountsByIdea(db): Promise<Map<number, number>>`
  - `noteCountsByCountry(db): Promise<Record<string, number>>`
  - `addNote(db, n: { idea_id: number | null; country_iso: string | null; author: string; body: string }, now: string): Promise<Note>`
  - `listNotes(db, q: { idea_id?: number; country_iso?: string }): Promise<Note[]>` (oldest first)
  - `getSettings(db): Promise<Settings>`
  - `setSetting(db, key: "departure_date" | "budget_eur" | "flight_reserve_eur", value: string): Promise<void>`
  - `setUserName(db, id: string, name: string): Promise<void>`
  - `setLinkCode(db, userId: string, code: string, expiresIso: string): Promise<void>`
  - `consumeLinkCode(db, code: string, telegramId: number, nowIso: string): Promise<User | null>`
  - `getPending(db, telegramId: number): Promise<{ original: string; question: string } | null>`
  - `setPending(db, telegramId: number, original: string, question: string, now: string): Promise<void>`
  - `clearPending(db, telegramId: number): Promise<void>`
- Produces (`src/serialize.ts`): `toDto(row: IdeaRow, stars: Record<string, number>, me: string, other: string, noteCount: number): IdeaDto`
- Produces (`src/html.ts`): `escapeHtml(s: string): string`

- [ ] **Step 1: Write `src/types.ts`** exactly as in the Interfaces block above.

- [ ] **Step 2: Write the failing tests `test/db.test.ts`**

```ts
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
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/db.test.ts`
Expected: FAIL, cannot resolve `../src/db`.

- [ ] **Step 4: Implement `src/html.ts`**

```ts
const MAP: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => MAP[c]);
```

- [ ] **Step 5: Implement `src/db.ts`**

```ts
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
  return (await db.prepare("SELECT * FROM ideas ORDER BY created_at DESC").all<IdeaRow>()).results;
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
  await db.prepare("UPDATE users SET link_code = ?, link_code_expires = ? WHERE id = ?").bind(code, expiresIso, userId).run();
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
    db.prepare("UPDATE users SET telegram_id = ?, link_code = NULL, link_code_expires = NULL WHERE id = ?").bind(telegramId, user.id),
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
```

Note: `deleteIdea` deletes children explicitly because D1 does not enforce `ON DELETE CASCADE` unless `PRAGMA foreign_keys` is on for the connection.

- [ ] **Step 6: Implement `src/serialize.ts`**

```ts
import { monthMarks, type MonthTemp } from "./logic/weather";
import { viewRatings } from "./logic/ratings";
import type { IdeaDto, IdeaRow, PriceSeason } from "./types";

const parse = <T>(s: string | null): T | null => (s ? (JSON.parse(s) as T) : null);

export function toDto(
  row: IdeaRow,
  stars: Record<string, number>,
  me: string,
  other: string,
  noteCount: number,
): IdeaDto {
  const climate = parse<(MonthTemp | null)[]>(row.climate);
  const price = parse<PriceSeason[]>(row.price_season);
  const wildlife = parse<number[]>(row.wildlife_months);
  const marks = monthMarks({ season_basis: row.season_basis, climate, wildlife_months: wildlife });
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    description: row.description,
    lat: row.lat,
    lng: row.lng,
    country_iso: row.country_iso,
    region: row.region,
    source_url: row.source_url,
    photo_url: row.photo_key ? `/api/photos/${encodeURIComponent(row.photo_key)}` : null,
    added_by: row.added_by,
    must_do: row.must_do === 1,
    cost_pp_day: row.cost_pp_day,
    season_basis: row.season_basis,
    wildlife_months: wildlife,
    price_season: price,
    months: marks.map((weather, m) => ({ weather, price: price?.[m] ?? null, temp: climate?.[m] ?? null })),
    status: row.status,
    ratings: viewRatings(stars, me, other),
    note_count: noteCount,
    created_at: row.created_at,
  };
}
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run test/db.test.ts && npm run typecheck`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: D1 data access and idea serialization"
```

---

### Task 4: Auth, dependencies and the REST API

**Files:**
- Create: `src/auth.ts`, `src/deps.ts`, `src/telegram/api.ts` (interface + client), `src/ideas-service.ts`, `src/api.ts`
- Modify: `src/index.ts`
- Test: `test/stubs.ts`, `test/api.test.ts`

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces:
  - `src/telegram/api.ts`:
    ```ts
    export type InlineButton = { text: string; callback_data?: string; url?: string };
    export interface TelegramApi {
      sendMessage(chatId: number, html: string, opts?: { buttons?: InlineButton[][] }): Promise<{ message_id: number }>;
      editMessageText(chatId: number, messageId: number, html: string, opts?: { buttons?: InlineButton[][] }): Promise<void>;
      deleteMessage(chatId: number, messageId: number): Promise<void>;
      answerCallbackQuery(callbackQueryId: string, text: string): Promise<void>;
      getFileBytes(fileId: string): Promise<ArrayBuffer>;
    }
    export function telegramApi(token: string, fetchFn?: typeof fetch): TelegramApi;
    ```
  - `src/enrich.ts` types used here (implemented in Task 5): `EnrichedIdea`, `EnrichResult = { kind: "ideas"; ideas: EnrichedIdea[] } | { kind: "question"; question: string }`
  - `src/deps.ts`:
    ```ts
    export interface Deps {
      telegram: TelegramApi;
      enrich(input: string): Promise<EnrichResult>;
      climate(lat: number, lng: number): Promise<(MonthTemp | null)[] | null>;
      linkPreview(url: string): Promise<string | null>;
      now(): Date;
    }
    export function productionDeps(env: Env): Deps;
    ```
  - `src/auth.ts`: `currentUser(request: Request, env: Env): Promise<User | null>`
  - `src/ideas-service.ts`:
    ```ts
    export type AddResult =
      | { kind: "ideas"; ids: number[] }
      | { kind: "question"; question: string }
      | { kind: "none" }
      | { kind: "failed"; id: number };
    export function addIdeasFromText(db: D1Database, deps: Deps, userId: string, text: string,
      extra?: { photo_key?: string | null; source_url?: string | null }): Promise<AddResult>;
    export function firstUrl(text: string): string | null;
    ```
  - `src/api.ts`: `createApi(getDeps: (env: Env) => Deps): Hono<AppEnv>`
  - `test/stubs.ts`: `stubDeps(overrides?: Partial<Deps>): Deps & { sent: SentMessage[]; answers: string[] }`

- [ ] **Step 1: Create `src/telegram/api.ts`**

```ts
export type InlineButton = { text: string; callback_data?: string; url?: string };

export interface TelegramApi {
  sendMessage(chatId: number, html: string, opts?: { buttons?: InlineButton[][] }): Promise<{ message_id: number }>;
  editMessageText(chatId: number, messageId: number, html: string, opts?: { buttons?: InlineButton[][] }): Promise<void>;
  deleteMessage(chatId: number, messageId: number): Promise<void>;
  answerCallbackQuery(callbackQueryId: string, text: string): Promise<void>;
  getFileBytes(fileId: string): Promise<ArrayBuffer>;
}

export function telegramApi(token: string, fetchFn: typeof fetch = fetch): TelegramApi {
  const base = `https://api.telegram.org/bot${token}`;
  async function call<T>(method: string, body: unknown): Promise<T> {
    const res = await fetchFn(`${base}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok: boolean; result: T; description?: string };
    if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description ?? res.status}`);
    return data.result;
  }
  const markup = (buttons?: InlineButton[][]) => (buttons ? { reply_markup: { inline_keyboard: buttons } } : {});
  return {
    sendMessage: (chat_id, text, opts) =>
      call("sendMessage", { chat_id, text, parse_mode: "HTML", disable_web_page_preview: true, ...markup(opts?.buttons) }),
    editMessageText: async (chat_id, message_id, text, opts) => {
      await call("editMessageText", { chat_id, message_id, text, parse_mode: "HTML", ...markup(opts?.buttons) });
    },
    deleteMessage: async (chat_id, message_id) => {
      await call("deleteMessage", { chat_id, message_id });
    },
    answerCallbackQuery: async (callback_query_id, text) => {
      await call("answerCallbackQuery", { callback_query_id, text, show_alert: false });
    },
    getFileBytes: async (file_id) => {
      const file = await call<{ file_path: string }>("getFile", { file_id });
      const res = await fetchFn(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
      if (!res.ok) throw new Error(`Telegram file download failed: ${res.status}`);
      return res.arrayBuffer();
    },
  };
}
```

- [ ] **Step 2: Create a temporary `src/enrich.ts` with the types only** (Task 5 fills in the implementation)

```ts
import type { PriceSeason, Kind, SeasonBasis } from "./types";

export type EnrichedIdea = {
  title: string;
  kind: Kind;
  description: string;
  place_name: string;
  country_iso: string;
  lat: number;
  lng: number;
  cost_pp_day: number;
  season_basis: SeasonBasis;
  wildlife_months: number[] | null;
  price_season: PriceSeason[];
};

export type EnrichResult = { kind: "ideas"; ideas: EnrichedIdea[] } | { kind: "question"; question: string };
```

- [ ] **Step 3: Create `src/deps.ts`** (production wiring for `climate`, `enrich` and `linkPreview` is completed in Task 5; until then they throw)

```ts
import type { Env } from "./env";
import type { EnrichResult } from "./enrich";
import type { MonthTemp } from "./logic/weather";
import { telegramApi, type TelegramApi } from "./telegram/api";

export interface Deps {
  telegram: TelegramApi;
  enrich(input: string): Promise<EnrichResult>;
  climate(lat: number, lng: number): Promise<(MonthTemp | null)[] | null>;
  linkPreview(url: string): Promise<string | null>;
  now(): Date;
}

export function productionDeps(env: Env): Deps {
  const notYet = () => Promise.reject(new Error("not implemented yet"));
  return {
    telegram: telegramApi(env.TELEGRAM_BOT_TOKEN),
    enrich: notYet,
    climate: notYet,
    linkPreview: () => Promise.resolve(null),
    now: () => new Date(),
  };
}
```

- [ ] **Step 4: Create `src/auth.ts`**

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./env";
import { userByEmail } from "./db";
import type { User } from "./types";

const jwksByTeam = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function currentUser(request: Request, env: Env): Promise<User | null> {
  if ((env.APP_ENV === "dev" || env.APP_ENV === "test") && env.DEV_USER_EMAIL) {
    const email = request.headers.get("x-dev-user") ?? env.DEV_USER_EMAIL;
    return userByEmail(env.DB, email);
  }
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return null;
  const team = `https://${env.ACCESS_TEAM_DOMAIN}`;
  let jwks = jwksByTeam.get(team);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`));
    jwksByTeam.set(team, jwks);
  }
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: team, audience: env.ACCESS_AUD });
    return typeof payload.email === "string" ? userByEmail(env.DB, payload.email) : null;
  } catch {
    return null;
  }
}
```

(The `x-dev-user` header only works when `APP_ENV` is `dev` or `test`; production uses `wrangler.jsonc`'s `APP_ENV: "production"`.)

- [ ] **Step 5: Create `src/ideas-service.ts`**

```ts
import type { Deps } from "./deps";
import { insertIdea } from "./db";

const URL_RE = /https?:\/\/[^\s<>"]+/i;
export const firstUrl = (text: string): string | null => text.match(URL_RE)?.[0] ?? null;

export type AddResult =
  | { kind: "ideas"; ids: number[] }
  | { kind: "question"; question: string }
  | { kind: "none" }
  | { kind: "failed"; id: number };

export async function addIdeasFromText(
  db: D1Database,
  deps: Deps,
  userId: string,
  text: string,
  extra: { photo_key?: string | null; source_url?: string | null } = {},
): Promise<AddResult> {
  const now = () => deps.now().toISOString();
  const sourceUrl = extra.source_url ?? firstUrl(text);
  let input = text;
  if (sourceUrl) {
    const preview = await deps.linkPreview(sourceUrl).catch(() => null);
    if (preview) input += `\n\nLink preview: ${preview}`;
  }

  let result;
  try {
    result = await deps.enrich(input);
  } catch (err) {
    console.error("enrich failed", err);
    const id = await insertIdea(
      db,
      {
        title: text.trim().slice(0, 120) || "Untitled idea",
        kind: "place",
        added_by: userId,
        source_url: sourceUrl,
        photo_key: extra.photo_key ?? null,
        status: "needs_details",
      },
      now(),
    );
    return { kind: "failed", id };
  }

  if (result.kind === "question") return result;
  if (result.ideas.length === 0) return { kind: "none" };

  const ids: number[] = [];
  for (const idea of result.ideas) {
    const climate = await deps.climate(idea.lat, idea.lng).catch(() => null);
    ids.push(
      await insertIdea(
        db,
        {
          title: idea.title,
          kind: idea.kind,
          description: idea.description,
          lat: idea.lat,
          lng: idea.lng,
          country_iso: idea.country_iso,
          region: idea.place_name,
          cost_pp_day: idea.cost_pp_day,
          season_basis: idea.season_basis,
          wildlife_months: idea.wildlife_months,
          price_season: idea.price_season,
          climate,
          source_url: sourceUrl,
          photo_key: extra.photo_key ?? null,
          added_by: userId,
        },
        now(),
      ),
    );
  }
  return { kind: "ideas", ids };
}
```

- [ ] **Step 6: Create `src/api.ts`**

```ts
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

  const nowIso = (c: { var: { deps: Deps } }) => c.var.deps.now().toISOString();

  async function dto(c: { env: Env; var: AppEnv["Variables"] }, id: number) {
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
    const extra: Record<string, unknown> = {};
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
```

- [ ] **Step 7: Update `src/index.ts`**

```ts
import type { Env } from "./env";
import { createApi } from "./api";
import { productionDeps } from "./deps";

const api = createApi(productionDeps);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/")) return api.fetch(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 8: Create `test/stubs.ts`**

```ts
import type { Deps } from "../src/deps";
import type { EnrichedIdea } from "../src/enrich";
import type { InlineButton } from "../src/telegram/api";

export type SentMessage = { chatId: number; html: string; buttons?: InlineButton[][] };

export const KOMODO: EnrichedIdea = {
  title: "Diving with mantas",
  kind: "activity",
  description: "Liveaboard trip.",
  place_name: "Komodo, Indonesia",
  country_iso: "IDN",
  lat: -8.55,
  lng: 119.48,
  cost_pp_day: 45,
  season_basis: "weather",
  wildlife_months: null,
  price_season: ["high", "high", "mid", "mid", "low", "low", "high", "high", "mid", "mid", "mid", "high"],
};

export function stubDeps(overrides: Partial<Deps> = {}) {
  const sent: SentMessage[] = [];
  const edited: SentMessage[] = [];
  const answers: string[] = [];
  let nextId = 1;
  const deps: Deps = {
    telegram: {
      sendMessage: async (chatId, html, opts) => {
        sent.push({ chatId, html, buttons: opts?.buttons });
        return { message_id: nextId++ };
      },
      editMessageText: async (chatId, _messageId, html, opts) => {
        edited.push({ chatId, html, buttons: opts?.buttons });
      },
      deleteMessage: async () => {},
      answerCallbackQuery: async (_id, text) => {
        answers.push(text);
      },
      getFileBytes: async () => new TextEncoder().encode("jpeg").buffer as ArrayBuffer,
    },
    enrich: async () => ({ kind: "ideas", ideas: [KOMODO] }),
    climate: async () => Array.from({ length: 12 }, () => ({ min: 24, max: 31 })),
    linkPreview: async () => null,
    now: () => new Date("2030-01-01T00:00:00.000Z"),
    ...overrides,
  };
  return Object.assign(deps, { sent, edited, answers });
}
```

- [ ] **Step 9: Write the failing API tests `test/api.test.ts`**

```ts
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
```

- [ ] **Step 10: Run tests**

Run: `npx vitest run test/api.test.ts && npm run typecheck`
Expected: all PASS.

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -m "feat: authenticated REST API with blind ratings, notes, settings and budget"
```

---

### Task 5: Climate, link preview and Claude enrichment

**Files:**
- Create: `src/climate.ts`, `src/link-preview.ts`
- Modify: `src/enrich.ts` (full implementation), `src/deps.ts` (production wiring)
- Test: `test/external.test.ts`

**Interfaces:**
- Consumes: `monthlyAverages` (Task 2), `EnrichedIdea`/`EnrichResult` (Task 4).
- Produces:
  - `climateClient(fetchFn?: typeof fetch, now?: () => Date): (lat: number, lng: number) => Promise<(MonthTemp | null)[] | null>`
  - `linkPreviewClient(fetchFn?: typeof fetch): (url: string) => Promise<string | null>`
  - `parseEnrichOutput(text: string): EnrichResult` (throws on invalid output)
  - `enrichClient(apiKey: string, now?: () => Date): (input: string) => Promise<EnrichResult>`
  - `ENRICH_SCHEMA` (JSON schema object)

- [ ] **Step 1: Write the failing tests `test/external.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { climateClient } from "../src/climate";
import { linkPreviewClient } from "../src/link-preview";
import { parseEnrichOutput } from "../src/enrich";
import { KOMODO } from "./stubs";

describe("climateClient", () => {
  it("requests the last 10 complete years and averages per month", async () => {
    let requested = "";
    const fetchFn = (async (url: string) => {
      requested = url;
      return Response.json({
        daily: { time: ["2016-01-01", "2016-01-02"], temperature_2m_min: [10, 12], temperature_2m_max: [20, 22] },
      });
    }) as unknown as typeof fetch;
    const climate = climateClient(fetchFn, () => new Date("2026-10-05T00:00:00Z"));
    const result = await climate(46, 7.75);
    expect(requested).toContain("start_date=2016-01-01");
    expect(requested).toContain("end_date=2025-12-31");
    expect(requested).toContain("latitude=46");
    expect(result?.[0]).toEqual({ min: 11, max: 21 });
    expect(result?.[5]).toBeNull();
  });

  it("returns null when the service fails", async () => {
    const climate = climateClient((async () => new Response("down", { status: 503 })) as unknown as typeof fetch);
    expect(await climate(0, 0)).toBeNull();
  });
});

describe("linkPreviewClient", () => {
  it("extracts og title and description", async () => {
    const html = `<html><head><title>Fallback</title><meta property="og:title" content="Komodo &amp; Rinca">
      <meta property="og:description" content="Dive trips"></head></html>`;
    const preview = linkPreviewClient((async () => new Response(html)) as unknown as typeof fetch);
    expect(await preview("https://x.test")).toBe("Komodo & Rinca — Dive trips");
  });

  it("returns null on errors", async () => {
    const preview = linkPreviewClient((async () => Promise.reject(new Error("x"))) as unknown as typeof fetch);
    expect(await preview("https://x.test")).toBeNull();
  });
});

describe("parseEnrichOutput", () => {
  it("returns ideas", () => {
    const out = parseEnrichOutput(JSON.stringify({ clarifying_question: null, ideas: [KOMODO] }));
    expect(out).toEqual({ kind: "ideas", ideas: [KOMODO] });
  });

  it("returns a clarifying question", () => {
    const out = parseEnrichOutput(JSON.stringify({ clarifying_question: "Georgia the country or the US state?", ideas: [] }));
    expect(out).toEqual({ kind: "question", question: "Georgia the country or the US state?" });
  });

  it("rejects a price season that is not 12 months long", () => {
    const bad = { ...KOMODO, price_season: ["low"] };
    expect(() => parseEnrichOutput(JSON.stringify({ clarifying_question: null, ideas: [bad] }))).toThrow();
  });

  it("rejects a lowercase country code", () => {
    const bad = { ...KOMODO, country_iso: "idn" };
    expect(() => parseEnrichOutput(JSON.stringify({ clarifying_question: null, ideas: [bad] }))).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/external.test.ts`
Expected: FAIL, cannot resolve `../src/climate`.

- [ ] **Step 3: Implement `src/climate.ts`**

```ts
import { monthlyAverages, type MonthTemp } from "./logic/weather";

export function climateClient(fetchFn: typeof fetch = fetch, now: () => Date = () => new Date()) {
  return async (lat: number, lng: number): Promise<(MonthTemp | null)[] | null> => {
    const endYear = now().getUTCFullYear() - 1;
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
      start_date: `${endYear - 9}-01-01`,
      end_date: `${endYear}-12-31`,
      daily: "temperature_2m_max,temperature_2m_min",
      timezone: "UTC",
    });
    try {
      const res = await fetchFn(`https://archive-api.open-meteo.com/v1/archive?${params}`);
      if (!res.ok) return null;
      const data = (await res.json()) as {
        daily?: { time: string[]; temperature_2m_min: (number | null)[]; temperature_2m_max: (number | null)[] };
      };
      if (!data.daily) return null;
      return monthlyAverages(data.daily.time, data.daily.temperature_2m_min, data.daily.temperature_2m_max);
    } catch {
      return null;
    }
  };
}
```

- [ ] **Step 4: Implement `src/link-preview.ts`**

```ts
const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

function meta(html: string, prop: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, "i");
  return html.match(re)?.[1] ?? null;
}

export function linkPreviewClient(fetchFn: typeof fetch = fetch) {
  return async (url: string): Promise<string | null> => {
    try {
      const res = await fetchFn(url, {
        signal: AbortSignal.timeout(5000),
        headers: { "user-agent": "Mozilla/5.0 (compatible; WereldreisBot/1.0)" },
      });
      if (!res.ok) return null;
      const html = (await res.text()).slice(0, 200_000);
      const title = meta(html, "og:title") ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? null;
      const description = meta(html, "og:description") ?? meta(html, "description");
      const parts = [title, description].filter((p): p is string => !!p).map(decode);
      return parts.length ? parts.join(" — ") : null;
    } catch {
      return null;
    }
  };
}
```

- [ ] **Step 5: Implement `src/enrich.ts`** (replace the Task 4 stub; keep the exported types identical)

```ts
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Kind, PriceSeason, SeasonBasis } from "./types";

export type EnrichedIdea = {
  title: string;
  kind: Kind;
  description: string;
  place_name: string;
  country_iso: string;
  lat: number;
  lng: number;
  cost_pp_day: number;
  season_basis: SeasonBasis;
  wildlife_months: number[] | null;
  price_season: PriceSeason[];
};

export type EnrichResult = { kind: "ideas"; ideas: EnrichedIdea[] } | { kind: "question"; question: string };

const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] });

// Kept to keywords structured outputs accepts; numeric ranges and lengths are enforced by zod below.
export const ENRICH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["clarifying_question", "ideas"],
  properties: {
    clarifying_question: nullable({ type: "string" }),
    ideas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title", "kind", "description", "place_name", "country_iso", "lat", "lng",
          "cost_pp_day", "season_basis", "wildlife_months", "price_season",
        ],
        properties: {
          title: { type: "string" },
          kind: { type: "string", enum: ["place", "activity"] },
          description: { type: "string" },
          place_name: { type: "string" },
          country_iso: { type: "string" },
          lat: { type: "number" },
          lng: { type: "number" },
          cost_pp_day: { type: "integer" },
          season_basis: { type: "string", enum: ["weather", "wildlife"] },
          wildlife_months: nullable({ type: "array", items: { type: "integer" } }),
          price_season: { type: "array", items: { type: "string", enum: ["low", "mid", "high"] } },
        },
      },
    },
  },
} as const;

const IdeaSchema = z.object({
  title: z.string().trim().min(1).max(120),
  kind: z.enum(["place", "activity"]),
  description: z.string().max(600),
  place_name: z.string().min(1).max(120),
  country_iso: z.string().regex(/^[A-Z]{3}$/),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  cost_pp_day: z.number().int().min(0).max(5000),
  season_basis: z.enum(["weather", "wildlife"]),
  wildlife_months: z.array(z.number().int().min(1).max(12)).nullable(),
  price_season: z.array(z.enum(["low", "mid", "high"])).length(12),
});
const OutputSchema = z.object({ clarifying_question: z.string().nullable(), ideas: z.array(IdeaSchema) });

export function parseEnrichOutput(text: string): EnrichResult {
  const out = OutputSchema.parse(JSON.parse(text));
  if (out.clarifying_question && out.clarifying_question.trim()) {
    return { kind: "question", question: out.clarifying_question.trim() };
  }
  return { kind: "ideas", ideas: out.ideas };
}

const SYSTEM = `You help two travellers collect ideas for a long, loosely planned world trip.
You receive a short message from one of them: free text, a link with its page preview, a photo caption or a location pin.
Turn it into zero or more trip ideas. One message can mention several places or activities; return each as its own idea.

For each idea:
- title: short and specific, max 60 characters, in English (e.g. "Diving with mantas").
- kind: "place" for a destination to stay, "activity" for something to do.
- description: one or two plain sentences on what it is and why it's special.
- place_name: the specific place followed by the country name, e.g. "Komodo, Indonesia".
- country_iso: ISO 3166-1 alpha-3 code in capitals.
- lat, lng: coordinates of the spot itself (for a trek, the trailhead; for a region, its centre).
- cost_pp_day: typical total daily cost for one budget-to-midrange traveller in euros (accommodation, food, local transport, plus the activity's own daily cost if it is an activity).
- season_basis: "wildlife" only when the idea is about seeing animals (safaris, migrations, whale or manta sightings, turtle nesting); otherwise "weather".
- wildlife_months: for wildlife ideas, the months (1-12) with the best sightings; otherwise null.
- price_season: exactly 12 values for January..December: "high" when prices peak (holidays, peak tourist season), "low" when cheapest, otherwise "mid".

If the message is too ambiguous to place on a map (for example "Georgia" could be the country or the US state), return no ideas and set clarifying_question to one short question. Otherwise clarifying_question is null.
If the message contains no place or activity at all, return no ideas and clarifying_question null.`;

export function enrichClient(apiKey: string, now: () => Date = () => new Date()) {
  const client = new Anthropic({ apiKey, timeout: 25_000, maxRetries: 0 });
  return async (input: string): Promise<EnrichResult> => {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      // @ts-expect-error -- `fallbacks: "default"` may be missing from the installed SDK's types
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: ENRICH_SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: `Today is ${now().toISOString().slice(0, 10)}.\n\nMessage:\n${input}` }],
    });
    if (response.stop_reason === "refusal") throw new Error("Enrichment was declined");
    if (response.stop_reason === "max_tokens") throw new Error("Enrichment output was cut off");
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") throw new Error("Enrichment returned no text");
    return parseEnrichOutput(text.text);
  };
}
```

If `npm run typecheck` reports the `@ts-expect-error` as unused (the SDK already types `fallbacks`), delete that comment line.

- [ ] **Step 6: Wire production deps in `src/deps.ts`**

```ts
import type { Env } from "./env";
import { enrichClient, type EnrichResult } from "./enrich";
import { climateClient } from "./climate";
import { linkPreviewClient } from "./link-preview";
import type { MonthTemp } from "./logic/weather";
import { telegramApi, type TelegramApi } from "./telegram/api";

export interface Deps {
  telegram: TelegramApi;
  enrich(input: string): Promise<EnrichResult>;
  climate(lat: number, lng: number): Promise<(MonthTemp | null)[] | null>;
  linkPreview(url: string): Promise<string | null>;
  now(): Date;
}

export function productionDeps(env: Env): Deps {
  return {
    telegram: telegramApi(env.TELEGRAM_BOT_TOKEN),
    enrich: enrichClient(env.ANTHROPIC_API_KEY),
    climate: climateClient(),
    linkPreview: linkPreviewClient(),
    now: () => new Date(),
  };
}
```

- [ ] **Step 7: Run all tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS.

- [ ] **Step 8: One live smoke test of enrichment (needs a real key; costs about one cent)**

Create `scripts/enrich-smoke.mjs` (not committed — matches `*.local.*` only if named so; name it `scripts/enrich-smoke.local.mjs`):

```js
import { enrichClient } from "../src/enrich.ts";
const enrich = enrichClient(process.env.ANTHROPIC_API_KEY);
console.log(JSON.stringify(await enrich("Komodo diving with mantas 🦈"), null, 2));
console.log(JSON.stringify(await enrich("Georgia"), null, 2));
```

Run: `ANTHROPIC_API_KEY=... npx tsx scripts/enrich-smoke.local.mjs`
Expected: first call returns one idea in IDN with 12 price seasons; second returns a clarifying question. If the API rejects the schema, adjust `ENRICH_SCHEMA` (not the zod schema) and re-run.

- [ ] **Step 9: Commit**

```bash
git add src test && git commit -m "feat: Open-Meteo climate, link previews and Claude enrichment"
```

---

### Task 6: Telegram webhook

**Files:**
- Create: `src/telegram/webhook.ts`
- Modify: `src/index.ts`
- Test: `test/webhook.test.ts`

**Interfaces:**
- Consumes: Deps, db, `addIdeasFromText`, `monthMarks`, `monthRanges`, `viewRatings`, `escapeHtml`.
- Produces:
  - `type TgUpdate` (subset used below)
  - `handleUpdate(update: TgUpdate, env: Env, deps: Deps): Promise<void>`
  - `ideaSummary(row: IdeaRow): string` (HTML)
  - `ideaButtons(id: number, appUrl: string): InlineButton[][]`
  - `src/index.ts` route `POST /telegram`: 401 on wrong secret, otherwise `200` immediately with work in `ctx.waitUntil`.

- [ ] **Step 1: Write the failing tests `test/webhook.test.ts`**

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/webhook.test.ts`
Expected: FAIL, cannot resolve `../src/telegram/webhook`.

- [ ] **Step 3: Implement `src/telegram/webhook.ts`**

```ts
import type { Env } from "../env";
import type { Deps } from "../deps";
import type { IdeaRow, PriceSeason } from "../types";
import type { InlineButton } from "./api";
import * as db from "../db";
import { addIdeasFromText, firstUrl } from "../ideas-service";
import { monthMarks, type MonthTemp } from "../logic/weather";
import { monthRanges } from "../logic/months";
import { viewRatings } from "../logic/ratings";
import { escapeHtml } from "../html";

export type TgUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number };
    chat: { id: number };
    text?: string;
    caption?: string;
    photo?: { file_id: string; width: number; height: number }[];
    location?: { latitude: number; longitude: number };
  };
  callback_query?: {
    id: string;
    from: { id: number };
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
};

const UNDO_MS = 10 * 60_000;
const HELP =
  "Send me a place or activity (text, a link, a photo with a caption, or a location pin) and I'll add it to your globe.";

export function ideaSummary(row: IdeaRow): string {
  const climate = row.climate ? (JSON.parse(row.climate) as (MonthTemp | null)[]) : null;
  const wildlife = row.wildlife_months ? (JSON.parse(row.wildlife_months) as number[]) : null;
  const price = row.price_season ? (JSON.parse(row.price_season) as PriceSeason[]) : null;
  const marks = monthMarks({ season_basis: row.season_basis, climate, wildlife_months: wildlife });
  const good = monthRanges(marks.flatMap((m, i) => (m === "good" ? [i + 1] : [])));
  const cheap = monthRanges(price?.flatMap((p, i) => (p === "low" ? [i + 1] : [])) ?? []);
  const parts = [`Added: <b>${escapeHtml(row.title)}</b>${row.region ? ` — ${escapeHtml(row.region)}` : ""}`];
  if (good) parts.push(`${row.season_basis === "wildlife" ? "best sightings" : "good"} ${good}`);
  if (cheap) parts.push(`cheapest ${cheap}`);
  if (row.cost_pp_day != null) parts.push(`~€${row.cost_pp_day}/day`);
  return parts.join(" · ");
}

export function ideaButtons(id: number, appUrl: string): InlineButton[][] {
  return [
    [1, 2, 3, 4, 5].map((n) => ({ text: `⭐${n}`, callback_data: `r:${id}:${n}` })),
    [
      { text: "Open on globe", url: `${appUrl}/#idea-${id}` },
      { text: "Undo", callback_data: `u:${id}` },
    ],
  ];
}

export async function handleUpdate(update: TgUpdate, env: Env, deps: Deps): Promise<void> {
  if (update.callback_query) return handleCallback(update.callback_query, env, deps);
  const msg = update.message;
  if (!msg?.from) return;
  const chat = msg.chat.id;
  const nowIso = deps.now().toISOString();
  const text = (msg.text ?? msg.caption ?? "").trim();

  if (text.startsWith("/start")) {
    const code = text.split(/\s+/)[1];
    if (!code) {
      if (await db.userByTelegram(env.DB, msg.from.id)) await deps.telegram.sendMessage(chat, HELP);
      return;
    }
    const user = await db.consumeLinkCode(env.DB, code, msg.from.id, nowIso);
    await deps.telegram.sendMessage(
      chat,
      user
        ? `Linked! Hi ${escapeHtml(user.name)}. ${HELP}`
        : "That code is invalid or expired. Get a new one in the app under “Link Telegram”.",
    );
    return;
  }

  const user = await db.userByTelegram(env.DB, msg.from.id);
  if (!user) return;
  if (text === "/help") {
    await deps.telegram.sendMessage(chat, HELP);
    return;
  }

  let input = text;
  if (msg.location) input = `${input}\nLocation pin: ${msg.location.latitude}, ${msg.location.longitude}`.trim();

  let photoKey: string | null = null;
  if (msg.photo?.length) {
    const largest = msg.photo[msg.photo.length - 1];
    const bytes = await deps.telegram.getFileBytes(largest.file_id);
    photoKey = `photos/${crypto.randomUUID()}.jpg`;
    await env.PHOTOS.put(photoKey, bytes, { httpMetadata: { contentType: "image/jpeg" } });
  }
  if (!input) {
    await deps.telegram.sendMessage(chat, "Add a caption or some text that says which place or activity this is.");
    return;
  }

  const pending = await db.getPending(env.DB, msg.from.id);
  if (pending) {
    input = `${pending.original}\n\nYou asked: ${pending.question}\nAnswer: ${input}`;
    await db.clearPending(env.DB, msg.from.id);
  }

  const status = await deps.telegram.sendMessage(chat, "Looking it up…");
  const result = await addIdeasFromText(env.DB, deps, user.id, input, { photo_key: photoKey, source_url: firstUrl(text) });
  await deps.telegram.deleteMessage(chat, status.message_id).catch(() => {});

  if (result.kind === "question") {
    await db.setPending(env.DB, msg.from.id, input, result.question, nowIso);
    await deps.telegram.sendMessage(chat, escapeHtml(result.question));
  } else if (result.kind === "none") {
    await deps.telegram.sendMessage(chat, "I couldn't find a place or activity in that. Try something like “Diving in Komodo”.");
  } else if (result.kind === "failed") {
    await deps.telegram.sendMessage(chat, "Saved, but I couldn't look it up. Fill in the details in the app.", {
      buttons: [[{ text: "Open in app", url: `${env.APP_URL}/#idea-${result.id}` }]],
    });
  } else {
    for (const id of result.ids) {
      const row = await db.getIdeaRow(env.DB, id);
      if (row) await deps.telegram.sendMessage(chat, ideaSummary(row), { buttons: ideaButtons(id, env.APP_URL) });
    }
  }
}

async function handleCallback(cq: NonNullable<TgUpdate["callback_query"]>, env: Env, deps: Deps): Promise<void> {
  const user = await db.userByTelegram(env.DB, cq.from.id);
  if (!user || !cq.data) return;
  const [kind, idText, starsText] = cq.data.split(":");
  const id = Number(idText);
  const row = await db.getIdeaRow(env.DB, id);
  if (!row) {
    await deps.telegram.answerCallbackQuery(cq.id, "That idea no longer exists.");
    return;
  }
  const other = db.otherOf(await db.getUsers(env.DB), user.id);

  if (kind === "r") {
    const stars = Number(starsText);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) return;
    await db.setRating(env.DB, id, user.id, stars);
    const view = viewRatings(await db.starsFor(env.DB, id), user.id, other.id);
    const theirs = view.other != null ? `${other.name}: ${view.other}★.` : `${other.name} hasn't rated it yet.`;
    await deps.telegram.answerCallbackQuery(cq.id, `You gave ${stars}★. ${theirs}`);
    return;
  }

  if (kind === "u") {
    if (row.added_by !== user.id) {
      await deps.telegram.answerCallbackQuery(cq.id, "Only the person who added it can undo.");
      return;
    }
    if (deps.now().getTime() - Date.parse(row.created_at) > UNDO_MS) {
      await deps.telegram.answerCallbackQuery(cq.id, "Too late to undo here. You can delete it in the app.");
      return;
    }
    await db.deleteIdea(env.DB, id);
    if (cq.message) await deps.telegram.editMessageText(cq.message.chat.id, cq.message.message_id, `Removed: ${escapeHtml(row.title)}`);
    await deps.telegram.answerCallbackQuery(cq.id, "Removed.");
  }
}
```

- [ ] **Step 4: Add the `/telegram` route to `src/index.ts`**

```ts
import type { Env } from "./env";
import { createApi } from "./api";
import { productionDeps } from "./deps";
import { handleUpdate, type TgUpdate } from "./telegram/webhook";

const api = createApi(productionDeps);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/telegram" && request.method === "POST") {
      if (request.headers.get("x-telegram-bot-api-secret-token") !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("Forbidden", { status: 401 });
      }
      const update = (await request.json()) as TgUpdate;
      ctx.waitUntil(handleUpdate(update, env, productionDeps(env)).catch((err) => console.error("telegram update failed", err)));
      return new Response("ok");
    }
    if (pathname.startsWith("/api/")) return api.fetch(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 5: Run all tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: Telegram bot — linking, adding ideas, clarifying questions, rating and undo"
```

---

### Task 7: Map data build

**Files:**
- Create: `scripts/build-map-data.py`
- Generated (committed): `app/data/countries.json`, `app/data/borders.json`, `app/data/lakes.json`, `app/data/regions/<ISO>.json`, `app/tiles/{z}/{x}/{y}.jpg`

**Interfaces:**
- Produces for the front-end:
  - `app/data/countries.json`: FeatureCollection; properties `{ name, iso, cont, bbox: [w, s, e, n] }` (bbox of the main landmass group).
  - `app/data/borders.json`: land border lines (10 m).
  - `app/data/lakes.json`: lakes (10 m, scalerank ≤ 6).
  - `app/data/regions/<ISO>.json`: admin-1 polygons for that country, properties `{ name }`.
  - `app/tiles/{z}/{x}/{y}.jpg`: 512 px Web-Mercator tiles, z 0–4, Natural Earth II (colour +40 %, contrast +8 %).

- [ ] **Step 1: Write `scripts/build-map-data.py`**

```python
"""Build the globe's map data from Natural Earth. Run once; outputs are committed.

    python3 -m venv .venv && .venv/bin/pip install pillow numpy
    .venv/bin/python scripts/build-map-data.py
"""
import io, json, math, os, urllib.request, zipfile
import numpy as np
from PIL import Image, ImageEnhance

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "scripts", ".cache")
DATA = os.path.join(ROOT, "app", "data")
TILES = os.path.join(ROOT, "app", "tiles")
GEOJSON = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
NE2 = "https://naciscdn.org/naturalearth/50m/raster/NE2_50M_SR_W.zip"


def fetch(url, name):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        print("downloading", url)
        urllib.request.urlretrieve(url, path)
    return path


def load(name):
    return json.load(open(fetch(GEOJSON + name + ".geojson", name + ".geojson")))


def rnd(c, p):
    if isinstance(c[0], (int, float)):
        return [round(c[0], p), round(c[1], p)]
    return [rnd(x, p) for x in c]


def write(path, features):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump({"type": "FeatureCollection", "features": features}, open(path, "w"), separators=(",", ":"))


def area(ring):
    return abs(sum(ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1] for i in range(len(ring) - 1))) / 2


def bbox(ring):
    xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
    return [min(xs), min(ys), max(xs), max(ys)]


def countries():
    out = []
    for f in load("ne_50m_admin_0_countries")["features"]:
        p, g = f["properties"], f["geometry"]
        if p["CONTINENT"] == "Antarctica":
            continue
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        big = max(polys, key=lambda q: area(q[0]))
        bb, ba = bbox(big[0]), area(big[0])
        for q in polys:  # keep nearby large islands, drop overseas territories
            b = bbox(q[0])
            if area(q[0]) >= 0.15 * ba and abs((b[0] + b[2]) / 2 - (bb[0] + bb[2]) / 2) < 40:
                bb = [min(bb[0], b[0]), min(bb[1], b[1]), max(bb[2], b[2]), max(bb[3], b[3])]
        out.append({"type": "Feature",
                    "properties": {"name": p["NAME"], "iso": p["ADM0_A3"], "cont": p["CONTINENT"], "bbox": [round(x, 2) for x in bb]},
                    "geometry": {"type": g["type"], "coordinates": rnd(g["coordinates"], 2)}})
    write(os.path.join(DATA, "countries.json"), out)


def borders():
    feats = [{"type": "Feature", "properties": {}, "geometry": {"type": f["geometry"]["type"], "coordinates": rnd(f["geometry"]["coordinates"], 3)}}
             for f in load("ne_10m_admin_0_boundary_lines_land")["features"]]
    write(os.path.join(DATA, "borders.json"), feats)


def lakes():
    feats = [{"type": "Feature", "properties": {}, "geometry": {"type": f["geometry"]["type"], "coordinates": rnd(f["geometry"]["coordinates"], 3)}}
             for f in load("ne_10m_lakes")["features"] if (f["properties"].get("scalerank") or 0) <= 6]
    write(os.path.join(DATA, "lakes.json"), feats)


def regions():
    by_iso = {}
    for f in load("ne_10m_admin_1_states_provinces")["features"]:
        iso = f["properties"]["adm0_a3"]
        by_iso.setdefault(iso, []).append({"type": "Feature", "properties": {"name": f["properties"]["name"]},
                                           "geometry": {"type": f["geometry"]["type"], "coordinates": rnd(f["geometry"]["coordinates"], 3)}})
    for iso, feats in by_iso.items():
        write(os.path.join(DATA, "regions", iso + ".json"), feats)


def tiles():
    Image.MAX_IMAGE_PIXELS = None
    path = fetch(NE2, "NE2_50M_SR_W.zip")
    with zipfile.ZipFile(path) as z:
        tif = next(n for n in z.namelist() if n.endswith(".tif"))
        src = Image.open(io.BytesIO(z.read(tif))).convert("RGB")
    src = ImageEnhance.Contrast(ImageEnhance.Color(src).enhance(1.4)).enhance(1.08)
    n = 8192
    src = src.resize((n, src.height), Image.LANCZOS)
    a = np.asarray(src).astype(np.float32)
    h = a.shape[0]
    ys = np.arange(n) + 0.5
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * ys / n))))
    r = (90 - lat) / 180 * h - 0.5
    r0 = np.clip(np.floor(r).astype(int), 0, h - 1)
    r1 = np.clip(r0 + 1, 0, h - 1)
    t = (r - np.floor(r))[:, None, None]
    out = np.empty((n, n, 3), np.uint8)
    for s in range(0, n, 1024):
        sl = slice(s, s + 1024)
        out[sl] = np.clip(a[r0[sl]] * (1 - t[sl]) + a[r1[sl]] * t[sl], 0, 255).astype(np.uint8)
    merc = Image.fromarray(out)
    for zoom in range(5):
        k = 2 ** zoom
        img = merc if zoom == 4 else merc.resize((512 * k, 512 * k), Image.LANCZOS)
        for x in range(k):
            os.makedirs(os.path.join(TILES, str(zoom), str(x)), exist_ok=True)
            for y in range(k):
                img.crop((x * 512, y * 512, x * 512 + 512, y * 512 + 512)).save(
                    os.path.join(TILES, str(zoom), str(x), f"{y}.jpg"), quality=80, optimize=True, progressive=True)


if __name__ == "__main__":
    countries(); borders(); lakes(); regions(); tiles()
    print("done")
```

- [ ] **Step 2: Run it**

```bash
python3 -m venv .venv && .venv/bin/pip install pillow numpy
.venv/bin/python scripts/build-map-data.py
find app/tiles -name '*.jpg' | wc -l
du -sh app/data app/tiles
```
Expected: `341` tiles; `app/data` under ~15 MB; `app/tiles` about 9 MB.

- [ ] **Step 3: Spot-check**

```bash
python3 -c "import json;c=json.load(open('app/data/countries.json'));print(len(c['features']),[f['properties'] for f in c['features'] if f['properties']['iso']=='CHE'])"
ls app/data/regions | wc -l
```
Expected: ~240 countries; Switzerland bbox ≈ `[5.97, 45.83, 10.45, 47.78]`; ~250 region files.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-map-data.py app/data app/tiles
git commit -m "feat: generated Natural Earth map data and relief tiles"
```

---

### Task 8: Globe front-end shell (map, drill-down, pins, list panel)

**Files:**
- Create: `app/index.html` (replace placeholder), `app/css/app.css`, `app/js/util.js`, `app/js/api.js`, `app/js/state.js`, `app/js/geo.js`, `app/js/globe.js`, `app/js/panel.js`, `app/js/main.js`, `test/fixtures/dev-seed.sql`

**Interfaces:**
- Consumes: API from Task 4; map data from Task 7.
- Produces (browser modules):
  - `util.js`: `esc(s)`, `el(html) → Element`, `toast(text)`, `MONTHS`
  - `api.js`: `api.me()`, `api.ideas()`, `api.createIdea(body)`, `api.enrichIdea(text)`, `api.updateIdea(id, body)`, `api.deleteIdea(id)`, `api.rate(id, stars)`, `api.notes({idea}|{country})`, `api.addNote(body)`, `api.settings()`, `api.saveSettings(body)`, `api.budget()`, `api.linkCode()`
  - `state.js`: `state`, `update(patch)`, `subscribe(fn)`, `upsertIdea(dto)`, `removeIdea(id)`, `nameOf(userId)`
    - `state = { me, other, ideas, countryNotes, settings, countries: Map<iso, props>, view: { level: "world"|"continent"|"country", cont, iso, ideaId } }`
  - `geo.js`: `CONTINENTS` (bounds by continent name), `loadCountries() → { geojson, byIso: Map }`
  - `globe.js`: `createGlobe(container, { countriesGeo, onNavigate(view), onOpenIdea(id) }) → { ready: Promise, setIdeas(ideas), go(view), flyToIdea(idea) }`
  - `panel.js`: `renderPanel()` — head + body for world/continent/country lists; idea card is rendered by `card.js` (Task 9) through `renderCard(container, idea)`; until Task 9 exists, `panel.js` shows the title only.
  - Deep links: `#idea-<id>`, `#country-<ISO>`.

- [ ] **Step 1: `app/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Wereldreis</title>
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unbounded:wght@500;700&family=Figtree:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap">
  <link rel="stylesheet" href="css/app.css">
</head>
<body>
  <div id="app">
    <div id="map" role="application" aria-label="Globe of trip ideas"></div>
    <div class="loading" id="loading">LOADING THE WORLD…</div>
    <header class="top">
      <div class="brand"><h1>Wereldreis</h1><span class="sub" id="sub"></span></div>
      <nav class="crumbs" id="crumbs" aria-label="Zoom level"></nav>
    </header>
    <div class="toast" id="toast" role="status" hidden></div>
    <aside class="panel" id="panel">
      <button class="grab" id="grab" aria-label="Expand or collapse the panel"><span></span></button>
      <div class="panel-head" id="head"></div>
      <div class="panel-body" id="body"></div>
      <div class="credit">Relief: Natural Earth · Satellite: Sentinel-2 cloudless 2024 by EOX, contains modified Copernicus Sentinel data</div>
    </aside>
    <dialog id="dialog"></dialog>
  </div>
  <script src="https://unpkg.com/maplibre-gl@5.6.0/dist/maplibre-gl.js"></script>
  <script type="module" src="js/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: `app/css/app.css`** (prototype styles plus card, stars, notes, forms, dialog)

```css
/* Night-sky expedition chart: full-bleed globe, floating header, one panel (right on desktop, bottom sheet on phone). Deliberately single dark theme. */
:root {
  color-scheme: dark;
  --space: #060a13;
  --land: #e4d9be;
  --ink: #eef1f5;
  --ink-soft: #a9b4c3;
  --ink-faint: #6f7c8e;
  --glass: rgba(10, 17, 30, 0.86);
  --line: rgba(255, 255, 255, 0.09);
  --a: #f4a63a;
  --b: #ff7fa3;
  --go: #6fe0c4;
  --warn: #f2c14e;
  --bad: #ff8a7a;
  --f-display: "Unbounded", "Arial Black", system-ui, sans-serif;
  --f-body: "Figtree", system-ui, -apple-system, "Segoe UI", sans-serif;
  --f-mono: "DM Mono", ui-monospace, "SF Mono", Menlo, monospace;
  --panel-w: 380px;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { height: 100%; margin: 0; }
body { background: var(--space); color: var(--ink); font: 15px/1.45 var(--f-body); overflow: hidden; }
#app { position: fixed; inset: 0; }
#map { position: absolute; inset: 0; background: var(--space) var(--stars, none); }
.maplibregl-ctrl-attrib { display: none; }
button { font: inherit; color: inherit; }
button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 2px solid var(--go); outline-offset: 2px; }

.top { position: absolute; top: 0; left: 0; right: 0; padding: calc(env(safe-area-inset-top, 0px) + 16px) 16px 0; display: flex; flex-direction: column; gap: 10px; pointer-events: none; z-index: 2; }
.top > * { pointer-events: auto; }
.brand { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.brand h1 { margin: 0; font: 700 22px var(--f-display); text-shadow: 0 2px 16px rgba(0,0,0,.6); }
.brand .sub { font: 12px var(--f-mono); color: var(--ink-soft); letter-spacing: .04em; text-shadow: 0 1px 8px rgba(0,0,0,.8); }
.brand .sub b { color: var(--go); font-weight: 500; }
.crumbs { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; align-self: flex-start; background: var(--glass); border: 1px solid var(--line); border-radius: 999px; padding: 4px; backdrop-filter: blur(8px); }
.crumbs button { font-weight: 500; font-size: 13px; color: var(--ink-soft); background: none; border: 0; padding: 6px 12px; border-radius: 999px; cursor: pointer; }
.crumbs button:hover { color: var(--ink); background: rgba(255,255,255,.06); }
.crumbs button[aria-current="true"] { color: var(--space); background: var(--ink); cursor: default; }
.crumbs .sep { color: var(--ink-faint); font-size: 12px; }

.loading { position: absolute; inset: 0; display: grid; place-items: center; font: 500 13px var(--f-mono); color: var(--ink-soft); letter-spacing: .1em; pointer-events: none; }
.toast { position: absolute; left: 50%; transform: translateX(-50%); top: calc(env(safe-area-inset-top, 0px) + 110px); z-index: 5; background: var(--ink); color: var(--space); padding: 8px 14px; border-radius: 999px; font-weight: 600; font-size: 14px; }

.panel { position: absolute; z-index: 3; background: var(--glass); border: 1px solid var(--line); backdrop-filter: blur(14px); display: flex; flex-direction: column; overflow: hidden; }
@media (min-width: 760px) {
  .panel { top: calc(env(safe-area-inset-top, 0px) + 16px); right: 16px; bottom: 16px; width: var(--panel-w); border-radius: 18px; }
  .grab { display: none; }
}
@media (max-width: 759px) {
  .panel { left: 0; right: 0; bottom: 0; border-radius: 18px 18px 0 0; max-height: 52%; padding-bottom: env(safe-area-inset-bottom, 0px); transition: max-height .3s ease; }
  .panel.collapsed { max-height: calc(84px + env(safe-area-inset-bottom, 0px)); }
  .brand h1 { font-size: 18px; }
}
.grab { border: 0; background: none; padding: 8px 0 0; cursor: pointer; display: flex; justify-content: center; }
.grab span { width: 40px; height: 4px; border-radius: 4px; background: var(--ink-faint); }
.panel-head { padding: 14px 18px 12px; border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; }
.panel-head h2 { margin: 0; font: 700 20px/1.2 var(--f-display); text-wrap: balance; }
.eyebrow { font: 500 11px var(--f-mono); text-transform: uppercase; letter-spacing: .12em; color: var(--ink-faint); display: flex; justify-content: space-between; gap: 8px; }
.tally { display: flex; gap: 14px; font-size: 13px; color: var(--ink-soft); flex-wrap: wrap; }
.panel-body { overflow-y: auto; padding: 8px 8px 16px; flex: 1; min-height: 0; }
.credit { font-size: 10.5px; line-height: 1.4; color: var(--ink-faint); padding: 8px 18px 10px; border-top: 1px solid var(--line); }

.who { display: inline-flex; align-items: center; gap: 6px; }
.dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex: none; }
.dot.a { background: var(--a); } .dot.b { background: var(--b); }
.unread { width: 7px; height: 7px; border-radius: 50%; background: var(--go); display: inline-block; margin-left: 6px; vertical-align: middle; }

.actions { display: flex; gap: 8px; flex-wrap: wrap; padding: 6px 10px 2px; }
.btn { border: 1px solid var(--line); background: rgba(255,255,255,.06); border-radius: 999px; padding: 7px 14px; font-weight: 600; font-size: 13px; cursor: pointer; }
.btn:hover { background: rgba(255,255,255,.12); }
.btn.primary { background: var(--go); color: var(--space); border-color: transparent; }
.btn.danger { color: var(--bad); }
.btn:disabled { opacity: .5; cursor: default; }

.group { font: 500 11px var(--f-mono); text-transform: uppercase; letter-spacing: .12em; color: var(--ink-faint); padding: 14px 10px 6px; }
.row { width: 100%; display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 12px; padding: 10px; border: 0; border-radius: 10px; background: none; text-align: left; cursor: pointer; }
.row:hover { background: rgba(255,255,255,.06); }
.row .t { font-weight: 600; min-width: 0; }
.row .s { display: block; font-size: 12.5px; color: var(--ink-soft); font-weight: 400; margin-top: 2px; }
.row .n { font: 500 12px var(--f-mono); color: var(--ink-soft); }
.row .must { color: var(--warn); }
.empty { color: var(--ink-soft); padding: 16px 10px; font-size: 14px; line-height: 1.5; }
.badge { font: 500 10.5px var(--f-mono); letter-spacing: .06em; text-transform: uppercase; padding: 2px 7px; border-radius: 4px; background: rgba(255,255,255,.08); color: var(--ink-soft); }
.badge.must { background: rgba(242,193,78,.18); color: var(--warn); }
.badge.todo { background: rgba(255,138,122,.16); color: var(--bad); }

.card { padding: 6px 10px; display: flex; flex-direction: column; gap: 14px; }
.back { align-self: flex-start; font-weight: 500; font-size: 13px; color: var(--ink-soft); background: none; border: 0; cursor: pointer; padding: 4px 0; }
.kind { font: 500 11px var(--f-mono); text-transform: uppercase; letter-spacing: .12em; color: var(--ink-faint); }
.card h3 { margin: 2px 0 0; font: 700 21px/1.25 var(--f-display); text-wrap: balance; }
.card .where { color: var(--ink-soft); font-size: 14px; }
.card p { margin: 0; max-width: 62ch; }
.card img.photo { width: 100%; border-radius: 10px; max-height: 240px; object-fit: cover; }
.card a { color: var(--go); }
.facts { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--line); border-radius: 10px; overflow: hidden; margin: 0; }
.facts div { background: rgba(255,255,255,.03); padding: 10px 12px; display: flex; flex-direction: column; gap: 3px; }
.facts dt { font: 500 10.5px var(--f-mono); text-transform: uppercase; letter-spacing: .12em; color: var(--ink-faint); }
.facts dd { margin: 0; font-variant-numeric: tabular-nums; }

.months { display: grid; grid-template-columns: 54px repeat(12, 1fr); gap: 3px; align-items: center; }
.months .lbl { font: 500 10px var(--f-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--ink-faint); }
.months .m { text-align: center; font: 500 10.5px var(--f-mono); color: var(--ink-faint); }
.months .m.dep { color: var(--ink); text-decoration: underline; text-underline-offset: 3px; }
.months button.cell { border: 0; border-radius: 4px; height: 22px; padding: 0; cursor: pointer; font: 500 11px var(--f-mono); }
.cell.good { background: rgba(111,224,196,.28); color: var(--go); }
.cell.borderline { background: rgba(242,193,78,.2); color: var(--warn); }
.cell.poor { background: rgba(255,255,255,.05); color: var(--ink-faint); }
.cell.unknown { background: transparent; color: var(--ink-faint); border: 1px dashed var(--line) !important; }
.cell.low { background: rgba(111,224,196,.22); color: var(--go); }
.cell.mid { background: rgba(255,255,255,.07); color: var(--ink-soft); }
.cell.high { background: rgba(255,138,122,.2); color: var(--bad); }
.month-detail { font: 12px var(--f-mono); color: var(--ink-soft); min-height: 1.4em; }

.stars { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.stars .who-lbl { min-width: 84px; font-size: 13px; color: var(--ink-soft); }
.stars button { background: none; border: 0; font-size: 22px; line-height: 1; cursor: pointer; color: var(--ink-faint); padding: 2px; }
.stars button.on { color: var(--warn); }
.stars .static { font-size: 18px; color: var(--warn); letter-spacing: 2px; }
.stars .hint { font-size: 13px; color: var(--ink-faint); }

.notes { display: flex; flex-direction: column; gap: 8px; }
.note { background: rgba(255,255,255,.04); border-radius: 10px; padding: 8px 10px; }
.note .meta { font: 11px var(--f-mono); color: var(--ink-faint); margin-bottom: 2px; }
.note-form { display: flex; gap: 8px; }
textarea, input, select { background: rgba(255,255,255,.06); border: 1px solid var(--line); border-radius: 10px; color: var(--ink); padding: 8px 10px; font: 14px var(--f-body); width: 100%; min-width: 0; }
textarea { resize: vertical; min-height: 44px; }

dialog { background: #0d1626; color: var(--ink); border: 1px solid var(--line); border-radius: 16px; padding: 0; width: min(520px, calc(100vw - 32px)); max-height: calc(100vh - 64px); }
dialog::backdrop { background: rgba(0,0,0,.55); }
.dlg { padding: 18px; display: flex; flex-direction: column; gap: 12px; }
.dlg h2 { margin: 0; font: 700 18px var(--f-display); }
.dlg label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--ink-soft); }
.dlg .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.dlg .foot { display: flex; justify-content: flex-end; gap: 8px; }
.dlg .error { color: var(--bad); font-size: 13px; }
.code { font: 500 28px var(--f-mono); letter-spacing: .2em; text-align: center; padding: 10px; background: rgba(255,255,255,.06); border-radius: 10px; user-select: all; }

.pin-label { font: 600 12.5px var(--f-body); color: var(--space); background: var(--land); padding: 3px 8px; border-radius: 6px; white-space: nowrap; box-shadow: 0 2px 10px rgba(0,0,0,.35); cursor: pointer; transform: translateY(-16px); border: 0; }
.pin-label.sel { background: var(--ink); outline: 2px solid var(--go); }
@media (prefers-reduced-motion: reduce) { .panel { transition: none; } }
```

- [ ] **Step 3: `app/js/util.js`**

```js
export const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

export function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

let toastTimer;
export function toast(text) {
  const t = document.getElementById("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

export const isPhone = () => innerWidth < 760;
export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function readSeen() {
  try { return JSON.parse(localStorage.getItem("seen-notes") || "{}"); } catch { return {}; }
}
export function markSeen(key, count) {
  try { localStorage.setItem("seen-notes", JSON.stringify({ ...readSeen(), [key]: count })); } catch {}
}
```

- [ ] **Step 4: `app/js/api.js`**

```js
async function req(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) throw new Error("You're signed out. Reload the page to sign in again.");
  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    try { message = (await res.json()).error ?? message; } catch {}
    throw new Error(message);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  me: () => req("GET", "/api/me"),
  ideas: () => req("GET", "/api/ideas"),
  createIdea: (body) => req("POST", "/api/ideas", body),
  enrichIdea: (text) => req("POST", "/api/ideas?enrich=1", { text }),
  updateIdea: (id, body) => req("PATCH", `/api/ideas/${id}`, body),
  deleteIdea: (id) => req("DELETE", `/api/ideas/${id}`),
  rate: (id, stars) => req("PUT", `/api/ideas/${id}/rating`, { stars }),
  notes: (q) => req("GET", `/api/notes?${new URLSearchParams(q)}`),
  addNote: (body) => req("POST", "/api/notes", body),
  settings: () => req("GET", "/api/settings"),
  saveSettings: (body) => req("PATCH", "/api/settings", body),
  budget: () => req("GET", "/api/budget"),
  linkCode: () => req("POST", "/api/telegram-link-code"),
};
```

- [ ] **Step 5: `app/js/state.js`**

```js
const listeners = new Set();

export const state = {
  me: null,
  other: null,
  ideas: [],
  countryNotes: {},
  settings: null,
  countries: new Map(),
  view: { level: "world", cont: null, iso: null, ideaId: null },
};

export function update(patch) {
  Object.assign(state, patch);
  listeners.forEach((fn) => fn(state));
}
export const subscribe = (fn) => listeners.add(fn);

export function upsertIdea(dto) {
  const ideas = state.ideas.filter((i) => i.id !== dto.id);
  ideas.unshift(dto);
  update({ ideas });
}
export const removeIdea = (id) => update({ ideas: state.ideas.filter((i) => i.id !== id) });
export const nameOf = (userId) => (userId === state.me?.id ? state.me.name : state.other?.name) ?? userId;
export const countryName = (iso) => state.countries.get(iso)?.name ?? iso ?? "Unknown country";
```

- [ ] **Step 6: `app/js/geo.js`**

```js
export const CONTINENTS = {
  "Europe": [[-25, 34], [42, 71]],
  "Asia": [[60, -11], [150, 55]],
  "Africa": [[-19, -36], [52, 37]],
  "North America": [[-168, 8], [-52, 70]],
  "South America": [[-82, -56], [-34, 13]],
  "Oceania": [[112, -48], [179, -9]],
};

export async function loadCountries() {
  const geojson = await (await fetch("data/countries.json")).json();
  const byIso = new Map(geojson.features.map((f) => [f.properties.iso, f.properties]));
  return { geojson, byIso };
}
```

- [ ] **Step 7: `app/js/globe.js`**

```js
import { CONTINENTS } from "./geo.js";
import { esc, isPhone, reducedMotion } from "./util.js";

const SAT = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg";
const CLEAR = "rgba(0,0,0,0)", LIFT = "rgba(255,255,255,0.22)", SHADE = "rgba(6,10,19,0.55)";
const COLORS = { a: "#f4a63a", b: "#ff7fa3" };

function starImage(color) {
  const s = 48, c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 9 : 21, a = (Math.PI / 5) * i - Math.PI / 2;
    g.lineTo(s / 2 + r * Math.cos(a), s / 2 + r * Math.sin(a));
  }
  g.closePath();
  g.fillStyle = color; g.fill();
  g.lineWidth = 3; g.strokeStyle = "#ffffff"; g.stroke();
  return g.getImageData(0, 0, s, s);
}

function starsBackdrop(container) {
  const c = document.createElement("canvas"); c.width = c.height = 800;
  const g = c.getContext("2d");
  for (let i = 0; i < 420; i++) {
    const r = Math.random();
    g.fillStyle = `rgba(255,255,255,${0.15 + r * 0.6})`;
    g.beginPath(); g.arc(Math.random() * 800, Math.random() * 800, r < 0.93 ? 0.6 : 1.3, 0, Math.PI * 2); g.fill();
  }
  container.style.setProperty("--stars", `url(${c.toDataURL()})`);
}

export function createGlobe(container, { countriesGeo, byIso, onNavigate, onOpenIdea }) {
  starsBackdrop(container);
  const map = new maplibregl.Map({
    container,
    center: [8, 30],
    zoom: isPhone() ? 0.9 : 1.6,
    minZoom: 0.6,
    maxZoom: 15,
    attributionControl: false,
    style: {
      version: 8,
      projection: { type: "globe" },
      sky: { "sky-color": "#1d5a85", "horizon-color": "#9fd0f2", "fog-color": "#4f8fc0", "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0] },
      sources: {
        relief: { type: "raster", tiles: [new URL("tiles/", location.href).href + "{z}/{x}/{y}.jpg"], tileSize: 512, maxzoom: 4 },
        sat: { type: "raster", tiles: [SAT], tileSize: 256, maxzoom: 15 },
      },
      layers: [
        { id: "ocean", type: "background", paint: { "background-color": "#4f8fc0" } },
        { id: "relief", type: "raster", source: "relief" },
        { id: "sat", type: "raster", source: "sat", minzoom: 4.5, paint: { "raster-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0, 6, 1] } },
      ],
    },
  });

  const view = { level: "world", cont: null, iso: null };
  let ideas = [];
  let labels = [];
  let selected = null;
  let spinning = !reducedMotion();

  const ready = new Promise((resolve) => map.on("load", async () => {
    const [borders, lakes] = await Promise.all(["data/borders.json", "data/lakes.json"].map((f) => fetch(f).then((r) => r.json())));
    map.addImage("star-a", starImage(COLORS.a));
    map.addImage("star-b", starImage(COLORS.b));
    map.addSource("countries", { type: "geojson", data: countriesGeo, promoteId: "iso" });
    map.addSource("borders", { type: "geojson", data: borders });
    map.addSource("lakes", { type: "geojson", data: lakes });
    map.addSource("regions", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addSource("pins", { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "id" });
    map.addLayer({ id: "land", type: "fill", source: "countries", paint: { "fill-color": landColor() } });
    map.addLayer({ id: "lakes", type: "fill", source: "lakes", minzoom: 3, maxzoom: 6, paint: { "fill-color": "#4d93cf" } });
    map.addLayer({ id: "regions", type: "line", source: "regions", paint: { "line-color": "rgba(255,255,255,0.6)", "line-width": 1, "line-dasharray": [2, 2] } });
    map.addLayer({ id: "borders", type: "line", source: "borders", paint: { "line-color": "rgba(255,255,255,0.55)", "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.4, 8, 1.6] } });
    map.addLayer({ id: "sel-border", type: "line", source: "countries", filter: ["==", ["get", "iso"], ""], paint: { "line-color": "#eef1f5", "line-width": 2 } });
    map.addLayer({ id: "pins", type: "circle", source: "pins", filter: ["==", ["get", "must"], 0], paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, ["case", ["boolean", ["feature-state", "sel"], false], 5, 3.5], 8, ["case", ["boolean", ["feature-state", "sel"], false], 10, 7]],
      "circle-color": ["match", ["get", "by"], "a", COLORS.a, COLORS.b],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 1, 1, 8, 2],
      "circle-pitch-alignment": "map",
    } });
    map.addLayer({ id: "pins-must", type: "symbol", source: "pins", filter: ["==", ["get", "must"], 1], layout: {
      "icon-image": ["match", ["get", "by"], "a", "star-a", "star-b"],
      "icon-size": ["interpolate", ["linear"], ["zoom"], 1, 0.35, 8, 0.7],
      "icon-allow-overlap": true,
    } });
    document.getElementById("loading").hidden = true;
    wire();
    applyView();
    spin();
    resolve();
  }));

  function landColor() {
    const hover = ["boolean", ["feature-state", "hover"], false];
    if (view.level === "world") return ["case", hover, LIFT, CLEAR];
    if (view.level === "continent") return ["case", ["!=", ["get", "cont"], view.cont], SHADE, hover, LIFT, CLEAR];
    return ["case", ["==", ["get", "iso"], view.iso], CLEAR, hover, "rgba(6,10,19,0.32)", SHADE];
  }

  function pinAt(pt) {
    const r = 10;
    return map.queryRenderedFeatures([[pt.x - r, pt.y - r], [pt.x + r, pt.y + r]], { layers: ["pins", "pins-must"] })[0];
  }

  let hovered = null;
  function wire() {
    ["mousedown", "touchstart", "wheel", "dragstart"].forEach((ev) => map.on(ev, () => (spinning = false)));
    map.on("moveend", spin);
    map.on("mousemove", (e) => {
      const pin = pinAt(e.point);
      const f = pin ? null : map.queryRenderedFeatures(e.point, { layers: ["land"] })[0];
      const id = f ? f.properties.iso : null;
      if (hovered !== id) {
        if (hovered) map.setFeatureState({ source: "countries", id: hovered }, { hover: false });
        if (id) map.setFeatureState({ source: "countries", id }, { hover: true });
        hovered = id;
      }
      map.getCanvas().style.cursor = pin || f ? "pointer" : "";
    });
    map.on("click", (e) => {
      const pin = pinAt(e.point);
      if (pin) return onOpenIdea(Number(pin.properties.id));
      const f = map.queryRenderedFeatures(e.point, { layers: ["land"] })[0];
      if (!f) return;
      const p = byIso.get(f.properties.iso);
      if (!p || !CONTINENTS[p.cont]) return;
      if (view.level === "world") onNavigate({ level: "continent", cont: p.cont, iso: null, ideaId: null });
      else if (view.level === "continent") onNavigate(p.cont === view.cont ? { level: "country", cont: p.cont, iso: p.iso, ideaId: null } : { level: "continent", cont: p.cont, iso: null, ideaId: null });
      else if (p.iso !== view.iso) onNavigate({ level: "country", cont: p.cont, iso: p.iso, ideaId: null });
    });
  }

  function spin() {
    if (!spinning || view.level !== "world" || map.isMoving()) return;
    const c = map.getCenter(); c.lng -= 8;
    map.easeTo({ center: c, duration: 1000, easing: (n) => n });
  }

  const padding = () => (isPhone()
    ? { top: 110, bottom: Math.round(innerHeight * 0.52) + 20, left: 24, right: 24 }
    : { top: 110, bottom: 40, left: 40, right: 380 + 56 });
  const fly = (b) => map.fitBounds(b, { padding: padding(), duration: reducedMotion() ? 0 : 2200, essential: true, maxZoom: 9 });

  async function loadRegions(iso) {
    let data = { type: "FeatureCollection", features: [] };
    if (iso) {
      try { const res = await fetch(`data/regions/${iso}.json`); if (res.ok) data = await res.json(); } catch {}
    }
    if (view.iso === iso) map.getSource("regions").setData(data);
  }

  function applyView() {
    if (!map.getLayer("land")) return;
    map.setPaintProperty("land", "fill-color", landColor());
    map.setFilter("sel-border", ["==", ["get", "iso"], view.iso ?? ""]);
    loadRegions(view.iso);
    renderLabels();
  }

  function renderLabels() {
    labels.forEach((l) => l.marker.remove());
    labels = [];
    if (view.level !== "country") return;
    ideas.filter((i) => i.country_iso === view.iso && i.lat != null).forEach((i) => {
      const b = document.createElement("button");
      b.className = "pin-label" + (selected === i.id ? " sel" : "");
      b.innerHTML = `${i.must_do ? "★ " : ""}${esc(i.title)}`;
      b.addEventListener("click", (ev) => { ev.stopPropagation(); onOpenIdea(i.id); });
      labels.push({ id: i.id, el: b, marker: new maplibregl.Marker({ element: b, anchor: "bottom" }).setLngLat([i.lng, i.lat]).addTo(map) });
    });
  }

  function setSelected(id) {
    if (selected != null) map.setFeatureState({ source: "pins", id: selected }, { sel: false });
    selected = id;
    if (id != null && map.getSource("pins")) map.setFeatureState({ source: "pins", id }, { sel: true });
    labels.forEach((l) => l.el.classList.toggle("sel", l.id === id));
  }

  return {
    ready,
    setIdeas(next) {
      ideas = next;
      if (!map.getSource("pins")) return;
      map.getSource("pins").setData({
        type: "FeatureCollection",
        features: ideas.filter((i) => i.lat != null && i.lng != null).map((i) => ({
          type: "Feature", id: i.id,
          properties: { id: i.id, by: i.added_by, must: i.must_do ? 1 : 0 },
          geometry: { type: "Point", coordinates: [i.lng, i.lat] },
        })),
      });
      renderLabels();
      if (selected != null) setSelected(selected);
    },
    go(next) {
      const changed = next.level !== view.level || next.cont !== view.cont || next.iso !== view.iso;
      Object.assign(view, { level: next.level, cont: next.cont, iso: next.iso });
      setSelected(next.ideaId ?? null);
      if (!changed) return;
      if (next.level === "world") {
        spinning = !reducedMotion();
        map.flyTo({ center: [map.getCenter().lng, 25], zoom: isPhone() ? 0.9 : 1.6, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: reducedMotion() ? 0 : 2000, essential: true });
      } else if (next.level === "continent") {
        fly(CONTINENTS[next.cont]);
      } else {
        const p = byIso.get(next.iso);
        if (p) fly([[p.bbox[0], p.bbox[1]], [p.bbox[2], p.bbox[3]]]);
      }
      applyView();
    },
    flyToIdea(idea) {
      if (idea.lat == null) return;
      map.flyTo({ center: [idea.lng, idea.lat], zoom: Math.max(map.getZoom(), 8), padding: padding(), duration: reducedMotion() ? 0 : 1800, essential: true });
    },
  };
}
```

- [ ] **Step 8: `app/js/panel.js`** (lists; the card hook is filled in by Task 9)

```js
import { state, countryName, nameOf } from "./state.js";
import { CONTINENTS } from "./geo.js";
import { esc, readSeen } from "./util.js";

export const hooks = { renderCard: null, onNavigate: null, onOpenIdea: null, onAction: null };

const ideasIn = (v) =>
  v.level === "world" ? state.ideas
  : v.level === "continent" ? state.ideas.filter((i) => state.countries.get(i.country_iso)?.cont === v.cont)
  : state.ideas.filter((i) => i.country_iso === v.iso);

function tally(list) {
  const a = list.filter((i) => i.added_by === state.me.id).length;
  return `<div class="tally"><span>${list.length} idea${list.length === 1 ? "" : "s"}</span>
    <span class="who"><i class="dot ${state.me.id}"></i>${esc(state.me.name)} ${a}</span>
    <span class="who"><i class="dot ${state.other.id}"></i>${esc(state.other.name)} ${list.length - a}</span></div>`;
}

function ideaRow(i) {
  const seen = readSeen()[`idea:${i.id}`] ?? 0;
  const unread = i.note_count > seen ? `<i class="unread" title="New notes"></i>` : "";
  const sub = [i.region ?? countryName(i.country_iso), i.kind === "activity" ? "Activity" : "Place"].filter(Boolean).join(" · ");
  return `<button class="row" data-idea="${i.id}"><i class="dot ${esc(i.added_by)}"></i>
    <span class="t">${i.must_do ? '<span class="must">★</span> ' : ""}${esc(i.title)}${unread}<span class="s">${esc(sub)}</span></span>
    <span class="n">${i.cost_pp_day != null ? `€${i.cost_pp_day}/d` : ""}</span></button>`;
}

export function renderCrumbs() {
  const v = state.view;
  const crumbs = [["World", { level: "world", cont: null, iso: null, ideaId: null }]];
  if (v.cont) crumbs.push([v.cont, { level: "continent", cont: v.cont, iso: null, ideaId: null }]);
  if (v.iso) crumbs.push([countryName(v.iso), { level: "country", cont: v.cont, iso: v.iso, ideaId: null }]);
  const nav = document.getElementById("crumbs");
  nav.innerHTML = "";
  crumbs.forEach(([label, target], idx) => {
    if (idx) nav.insertAdjacentHTML("beforeend", '<span class="sep">›</span>');
    const b = document.createElement("button");
    b.textContent = label;
    const last = idx === crumbs.length - 1 && v.ideaId == null;
    b.setAttribute("aria-current", String(last));
    if (!last) b.addEventListener("click", () => hooks.onNavigate(target));
    nav.append(b);
  });
}

export function renderPanel() {
  renderCrumbs();
  const head = document.getElementById("head");
  const body = document.getElementById("body");
  const v = state.view;

  if (v.ideaId != null) {
    const idea = state.ideas.find((i) => i.id === v.ideaId);
    if (idea && hooks.renderCard) {
      head.innerHTML = `<div class="eyebrow"><span>${esc(countryName(idea.country_iso))}</span></div>`;
      hooks.renderCard(body, idea);
      return;
    }
  }

  const list = ideasIn(v);
  const title = v.level === "world" ? "Your bucket list" : v.level === "continent" ? v.cont : countryName(v.iso);
  head.innerHTML = `<div class="eyebrow"><span>${v.level === "world" ? "World" : v.level}</span></div><h2>${esc(title)}</h2>${tally(list)}`;

  let html = `<div class="actions">
    <button class="btn primary" data-action="add">+ Add idea</button>
    ${v.level === "world" ? `<button class="btn" data-action="budget">Budget check</button><button class="btn" data-action="settings">Settings</button>${state.me.telegram_linked ? "" : '<button class="btn" data-action="link">Link Telegram</button>'}` : ""}
    ${v.level === "country" ? `<button class="btn" data-action="country-notes">Notes${state.countryNotes[v.iso] ? ` (${state.countryNotes[v.iso]})` : ""}</button>` : ""}
  </div>`;

  const todo = list.filter((i) => i.status === "needs_details");
  if (todo.length) html += `<div class="group">Needs details</div>` + todo.map(ideaRow).join("");

  if (v.level === "world") {
    html += `<div class="group">Continents</div>`;
    for (const c of Object.keys(CONTINENTS)) {
      const n = list.filter((i) => state.countries.get(i.country_iso)?.cont === c).length;
      html += `<button class="row" data-cont="${esc(c)}"><span class="dot" style="background:var(--land)"></span><span class="t">${esc(c)}<span class="s">${n ? "" : "No ideas yet"}</span></span><span class="n">${n || ""} ›</span></button>`;
    }
    const lost = list.filter((i) => i.status === "ready" && !state.countries.get(i.country_iso)?.cont);
    if (lost.length) html += `<div class="group">Elsewhere</div>` + lost.map(ideaRow).join("");
  } else if (v.level === "continent") {
    const isos = [...new Set(list.map((i) => i.country_iso))];
    if (!isos.length) html += `<div class="empty">No ideas in ${esc(v.cont)} yet. Send one to the Telegram bot, or tap “Add idea”.</div>`;
    else {
      html += `<div class="group">Countries</div>` + isos.map((iso) =>
        `<button class="row" data-iso="${esc(iso)}"><span class="dot" style="background:var(--land)"></span><span class="t">${esc(countryName(iso))}</span><span class="n">${list.filter((i) => i.country_iso === iso).length} ›</span></button>`).join("");
      html += `<div class="group">Ideas</div>` + list.filter((i) => i.status === "ready").map(ideaRow).join("");
    }
  } else {
    const ready = list.filter((i) => i.status === "ready");
    html += ready.length ? ready.map(ideaRow).join("") : `<div class="empty">No ideas in ${esc(title)} yet.</div>`;
  }

  body.innerHTML = html;
  body.querySelectorAll("[data-cont]").forEach((b) => b.addEventListener("click", () => hooks.onNavigate({ level: "continent", cont: b.dataset.cont, iso: null, ideaId: null })));
  body.querySelectorAll("[data-iso]").forEach((b) => b.addEventListener("click", () => {
    const iso = b.dataset.iso;
    hooks.onNavigate({ level: "country", cont: state.countries.get(iso)?.cont ?? state.view.cont, iso, ideaId: null });
  }));
  body.querySelectorAll("[data-idea]").forEach((b) => b.addEventListener("click", () => hooks.onOpenIdea(Number(b.dataset.idea))));
  body.querySelectorAll("[data-action]").forEach((b) => b.addEventListener("click", () => hooks.onAction?.(b.dataset.action)));
}

export { nameOf };
```

- [ ] **Step 9: `app/js/main.js`**

```js
import { api } from "./api.js";
import { state, update, subscribe } from "./state.js";
import { loadCountries } from "./geo.js";
import { createGlobe } from "./globe.js";
import { hooks, renderPanel } from "./panel.js";
import { isPhone, toast } from "./util.js";

let globe;

function navigate(view) {
  update({ view: { level: "world", cont: null, iso: null, ideaId: null, ...view } });
  globe.go(state.view);
  history.replaceState(null, "", view.ideaId != null ? `#idea-${view.ideaId}` : view.iso ? `#country-${view.iso}` : location.pathname);
}

export function openIdea(id) {
  const idea = state.ideas.find((i) => i.id === id);
  if (!idea) return toast("That idea no longer exists.");
  const p = state.countries.get(idea.country_iso);
  if (p) navigate({ level: "country", cont: p.cont, iso: p.iso, ideaId: id });
  else { navigate({ level: "world", ideaId: id }); globe.flyToIdea(idea); }
  document.getElementById("panel").classList.remove("collapsed");
}

export async function refreshIdeas() {
  const { ideas, country_note_counts } = await api.ideas();
  update({ ideas, countryNotes: country_note_counts });
  globe.setIdeas(ideas);
}

function renderSub() {
  const dep = state.settings?.departure_date;
  const sub = document.getElementById("sub");
  if (!dep) { sub.textContent = ""; return; }
  const days = Math.ceil((new Date(`${dep}T00:00:00`) - new Date()) / 86_400_000);
  const date = new Date(`${dep}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  sub.innerHTML = days > 0 ? `${state.me.name} &amp; ${state.other.name} · departure ${date} · <b>${days.toLocaleString("en-GB")}</b> days to go` : `${state.me.name} &amp; ${state.other.name} · on the road`;
}

function routeFromHash() {
  const m = location.hash.match(/^#(idea|country)-(.+)$/);
  if (!m) return;
  if (m[1] === "idea") openIdea(Number(m[2]));
  else {
    const p = state.countries.get(m[2]);
    if (p) navigate({ level: "country", cont: p.cont, iso: p.iso, ideaId: null });
  }
}

async function boot() {
  try {
    const [countries, me, settings, ideasRes] = await Promise.all([loadCountries(), api.me(), api.settings(), api.ideas()]);
    update({ me, other: me.other, settings, countries: countries.byIso, ideas: ideasRes.ideas, countryNotes: ideasRes.country_note_counts });
    globe = createGlobe(document.getElementById("map"), {
      countriesGeo: countries.geojson,
      byIso: countries.byIso,
      onNavigate: navigate,
      onOpenIdea: openIdea,
    });
    hooks.onNavigate = navigate;
    hooks.onOpenIdea = openIdea;
    subscribe(() => { renderPanel(); renderSub(); });
    renderPanel();
    renderSub();
    await globe.ready;
    globe.setIdeas(state.ideas);
    routeFromHash();
    addEventListener("hashchange", routeFromHash);
  } catch (err) {
    document.getElementById("loading").textContent = err.message;
  }
}

document.getElementById("grab").addEventListener("click", () => document.getElementById("panel").classList.toggle("collapsed"));
if (isPhone()) document.getElementById("panel").classList.add("collapsed");
boot();
```

- [ ] **Step 10: `test/fixtures/dev-seed.sql`** (fake data for local development only)

```sql
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
```

- [ ] **Step 11: Run locally and check by hand**

```bash
cp .dev.vars.example .dev.vars
npm run db:migrate:local && npm run db:seed:local
npm run dev
```
Open `http://localhost:8787` (desktop width) and at 390 px wide (devtools device mode). Check:
1. The globe spins with relief colours; orange and pink pins; the Zermatt idea shows as a star.
2. Click Europe → flies in; click Switzerland → cantons dashed, satellite imagery fades in, labels show; zoom close to Zermatt: sharp satellite.
3. The panel lists continents, countries and ideas; breadcrumbs go back out.
4. The "Sailing between atolls" idea appears under "Elsewhere" in the world list; clicking it flies to the pin without errors (Review Focus 4).
5. The header shows the countdown from the seed date.

- [ ] **Step 12: Commit**

```bash
git add app test/fixtures && git commit -m "feat: globe front-end with drill-down, pins and idea lists"
```

---

### Task 9: Idea card, ratings, notes and forms

**Files:**
- Create: `app/js/months.js`, `app/js/card.js`, `app/js/forms.js`
- Modify: `app/js/main.js` (register hooks)

**Interfaces:**
- Consumes: `api`, `state`, `update`, `upsertIdea`, `removeIdea`, `nameOf`, `countryName`, `hooks` (panel.js), `openIdea`, `refreshIdeas` (main.js).
- Produces:
  - `months.js`: `renderMonths(idea, departureDate) → HTMLElement`
  - `card.js`: `renderCard(container, idea)`
  - `forms.js`: `openAdd()`, `openEdit(idea)`, `openSettings()`, `openBudget()`, `openLink()`, `openCountryNotes(iso)`

- [ ] **Step 1: `app/js/months.js`**

```js
import { MONTHS, MONTH_NAMES, el } from "./util.js";

const WEATHER_SYMBOL = { good: "✓", borderline: "~", poor: "·", unknown: "?" };
const PRICE_SYMBOL = { low: "€", mid: "€€", high: "€€€" };

export function renderMonths(idea, departureDate) {
  const depMonth = departureDate ? Number(departureDate.slice(5, 7)) : null;
  const wrap = el(`<div><div class="months" role="table" aria-label="Best months"></div><div class="month-detail" aria-live="polite"></div></div>`);
  const grid = wrap.querySelector(".months");
  const detail = wrap.querySelector(".month-detail");
  grid.append(el(`<span></span>`));
  MONTHS.forEach((m, i) => grid.append(el(`<span class="m${i + 1 === depMonth ? " dep" : ""}" title="${i + 1 === depMonth ? "Departure month" : ""}">${m}</span>`)));

  const weatherLabel = idea.season_basis === "wildlife" ? "Wildlife" : "Weather";
  grid.append(el(`<span class="lbl">${weatherLabel}</span>`));
  idea.months.forEach((cell, i) => {
    const b = el(`<button class="cell ${cell.weather}" aria-label="${MONTH_NAMES[i]} ${weatherLabel.toLowerCase()}: ${cell.weather}">${WEATHER_SYMBOL[cell.weather]}</button>`);
    b.addEventListener("click", () => {
      if (idea.season_basis === "wildlife") detail.textContent = `${MONTH_NAMES[i]}: ${cell.weather === "good" ? "best sightings" : "fewer sightings"}`;
      else detail.textContent = cell.temp ? `${MONTH_NAMES[i]}: ${Math.round(cell.temp.min)}–${Math.round(cell.temp.max)} °C (${cell.weather})` : `${MONTH_NAMES[i]}: no climate data`;
    });
    grid.append(b);
  });

  grid.append(el(`<span class="lbl">Price</span>`));
  idea.months.forEach((cell, i) => {
    const p = cell.price;
    const b = el(`<button class="cell ${p ?? "unknown"}" aria-label="${MONTH_NAMES[i]} price: ${p ?? "unknown"}">${p ? PRICE_SYMBOL[p] : "?"}</button>`);
    b.addEventListener("click", () => (detail.textContent = `${MONTH_NAMES[i]}: ${p ? `${p} season (estimate)` : "no price estimate"}`));
    grid.append(b);
  });
  return wrap;
}
```

- [ ] **Step 2: `app/js/card.js`**

```js
import { api } from "./api.js";
import { state, upsertIdea, removeIdea, countryName, nameOf } from "./state.js";
import { hooks } from "./panel.js";
import { renderMonths } from "./months.js";
import { esc, el, markSeen, toast } from "./util.js";
import { openEdit } from "./forms.js";

function starsRow(label, value, onPick) {
  const row = el(`<div class="stars"><span class="who-lbl">${esc(label)}</span></div>`);
  for (let n = 1; n <= 5; n++) {
    const b = el(`<button class="${value != null && n <= value ? "on" : ""}" aria-label="${n} star${n > 1 ? "s" : ""}">★</button>`);
    b.addEventListener("click", () => onPick(n));
    row.append(b);
  }
  return row;
}

function otherStars(idea) {
  const name = esc(state.other.name);
  const r = idea.ratings;
  if (r.otherHidden) return el(`<div class="stars"><span class="who-lbl">${name}</span><span class="hint">Rate it to see ${name}'s stars</span></div>`);
  if (r.other == null) return el(`<div class="stars"><span class="who-lbl">${name}</span><span class="hint">Not rated yet</span></div>`);
  return el(`<div class="stars"><span class="who-lbl">${name}</span><span class="static" aria-label="${r.other} stars">${"★".repeat(r.other)}</span></div>`);
}

async function renderNotes(box, query, label) {
  box.innerHTML = `<div class="kind">Notes</div><div class="notes"><div class="hint">Loading…</div></div>
    <form class="note-form"><textarea id="note-body" rows="2" placeholder="Leave a note or question for ${esc(state.other.name)}"></textarea><button class="btn primary" type="submit">Send</button></form>`;
  const list = box.querySelector(".notes");
  const draw = (notes) => {
    list.innerHTML = notes.length
      ? notes.map((n) => `<div class="note"><div class="meta">${esc(n.author_name)} · ${new Date(n.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div>${esc(n.body)}</div>`).join("")
      : `<div class="hint">No notes yet.</div>`;
  };
  try {
    const notes = await api.notes(query);
    draw(notes);
    markSeen(query.idea ? `idea:${query.idea}` : `country:${query.country}`, notes.length);
  } catch (err) { list.textContent = err.message; }
  box.querySelector("form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const ta = box.querySelector("textarea");
    const body = ta.value.trim();
    if (!body) return;
    try {
      await api.addNote(query.idea ? { idea_id: Number(query.idea), body } : { country_iso: query.country, label, body });
      ta.value = "";
      const notes = await api.notes(query);
      draw(notes);
      markSeen(query.idea ? `idea:${query.idea}` : `country:${query.country}`, notes.length);
      toast(`Sent. ${state.other.name} gets a Telegram message.`);
    } catch (err) { toast(err.message); }
  });
}
export { renderNotes };

export function renderCard(container, idea) {
  const where = [idea.region, idea.region ? null : countryName(idea.country_iso)].filter(Boolean).join(", ");
  container.innerHTML = "";
  const card = el(`<div class="card">
    <button class="back">← All ideas in ${esc(countryName(idea.country_iso))}</button>
    <div>
      <div class="kind">${idea.kind === "activity" ? "Activity" : "Place"} ${idea.must_do ? '<span class="badge must">Must-do</span>' : ""} ${idea.status === "needs_details" ? '<span class="badge todo">Needs details</span>' : ""}</div>
      <h3>${esc(idea.title)}</h3>
      <div class="where">${esc(where)}</div>
    </div>
    ${idea.photo_url ? `<img class="photo" src="${esc(idea.photo_url)}" alt="">` : ""}
    ${idea.description ? `<p>${esc(idea.description)}</p>` : ""}
    ${idea.source_url ? `<a href="${esc(idea.source_url)}" target="_blank" rel="noopener">Original link ↗</a>` : ""}
    <dl class="facts">
      <div><dt>Added by</dt><dd class="who"><i class="dot ${esc(idea.added_by)}"></i>${esc(nameOf(idea.added_by))}</dd></div>
      <div><dt>Rough cost</dt><dd>${idea.cost_pp_day != null ? `€${idea.cost_pp_day} / day pp` : "Unknown"}</dd></div>
    </dl>
    <div class="months-slot"></div>
    <div class="ratings"><div class="kind">Ratings</div></div>
    <div class="notes-slot"></div>
    <div class="actions" style="padding:0">
      <button class="btn" data-a="must">${idea.must_do ? "Remove must-do" : "Mark as must-do"}</button>
      <button class="btn" data-a="edit">Edit</button>
      <button class="btn danger" data-a="delete">Delete</button>
    </div>
  </div>`);
  card.querySelector(".back").addEventListener("click", () => hooks.onNavigate({ ...state.view, ideaId: null }));
  card.querySelector(".months-slot").append(renderMonths(idea, state.settings?.departure_date));

  const ratings = card.querySelector(".ratings");
  ratings.append(starsRow("You", idea.ratings.mine, async (n) => {
    try { upsertIdea(await api.rate(idea.id, n)); } catch (err) { toast(err.message); }
  }));
  ratings.append(otherStars(idea));

  renderNotes(card.querySelector(".notes-slot"), { idea: idea.id }, idea.title);

  card.querySelector('[data-a="must"]').addEventListener("click", async () => {
    try { upsertIdea(await api.updateIdea(idea.id, { must_do: !idea.must_do })); } catch (err) { toast(err.message); }
  });
  card.querySelector('[data-a="edit"]').addEventListener("click", () => openEdit(idea));
  const del = card.querySelector('[data-a="delete"]');
  del.addEventListener("click", async () => {
    if (del.dataset.confirm !== "1") { del.dataset.confirm = "1"; del.textContent = "Tap again to delete"; return; }
    try {
      await api.deleteIdea(idea.id);
      removeIdea(idea.id);
      hooks.onNavigate({ ...state.view, ideaId: null });
      toast("Idea deleted.");
    } catch (err) { toast(err.message); }
  });
  container.append(card);
}
```

- [ ] **Step 3: `app/js/forms.js`**

```js
import { api } from "./api.js";
import { state, update, upsertIdea, countryName } from "./state.js";
import { esc, el, toast } from "./util.js";
import { renderNotes } from "./card.js";

const dialog = () => document.getElementById("dialog");

function show(html, onReady) {
  const d = dialog();
  d.innerHTML = "";
  const body = el(`<div class="dlg">${html}</div>`);
  d.append(body);
  body.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => d.close()));
  onReady(body);
  if (!d.open) d.showModal();
}

let openIdeaFn = () => {};
export const setOpenIdea = (fn) => (openIdeaFn = fn);

export function openAdd() {
  show(`<h2>Add an idea</h2>
    <label>Describe a place or activity. The details get filled in for you.
      <textarea id="add-text" rows="3" placeholder="e.g. Diving with mantas in Komodo"></textarea></label>
    <div class="error" id="add-error" hidden></div>
    <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="add-go">Add</button></div>`, (body) => {
    const ta = body.querySelector("#add-text");
    const go = body.querySelector("#add-go");
    const error = body.querySelector("#add-error");
    let original = "";
    go.addEventListener("click", async () => {
      const text = ta.value.trim();
      if (!text) return;
      go.disabled = true; go.textContent = "Looking it up…"; error.hidden = true;
      try {
        const input = original ? `${original}\n\nAnswer: ${text}` : text;
        const res = await api.enrichIdea(input);
        if (res.kind === "question") {
          original = input;
          ta.value = "";
          ta.placeholder = "Your answer";
          error.textContent = res.question; error.hidden = false;
        } else if (res.kind === "none") {
          error.textContent = "No place or activity found in that. Try something like “Diving in Komodo”."; error.hidden = false;
        } else {
          const ideas = res.kind === "ideas" ? res.ideas : [res.idea];
          ideas.forEach(upsertIdea);
          dialog().close();
          toast(res.kind === "failed" ? "Saved, but it couldn't be looked up. Fill in the details." : `Added ${ideas.length} idea${ideas.length > 1 ? "s" : ""}.`);
          openIdeaFn(ideas[0].id);
        }
      } catch (err) {
        error.textContent = err.message; error.hidden = false;
      } finally {
        go.disabled = false; go.textContent = "Add";
      }
    });
  });
}

export function openEdit(idea) {
  const opt = (v, cur, label) => `<option value="${v}"${v === cur ? " selected" : ""}>${label}</option>`;
  show(`<h2>Edit idea</h2>
    <label>Title<input id="e-title" value="${esc(idea.title)}" maxlength="120"></label>
    <div class="grid2">
      <label>Type<select id="e-kind">${opt("place", idea.kind, "Place")}${opt("activity", idea.kind, "Activity")}</select></label>
      <label>Best months based on<select id="e-basis">${opt("weather", idea.season_basis, "Weather")}${opt("wildlife", idea.season_basis, "Wildlife sightings")}</select></label>
    </div>
    <label>Description<textarea id="e-desc" rows="3">${esc(idea.description ?? "")}</textarea></label>
    <div class="grid2">
      <label>Place<input id="e-region" value="${esc(idea.region ?? "")}"></label>
      <label>Country code (3 letters)<input id="e-iso" value="${esc(idea.country_iso ?? "")}" maxlength="3"></label>
      <label>Latitude<input id="e-lat" inputmode="decimal" value="${idea.lat ?? ""}"></label>
      <label>Longitude<input id="e-lng" inputmode="decimal" value="${idea.lng ?? ""}"></label>
      <label>Cost per person per day (€)<input id="e-cost" inputmode="numeric" value="${idea.cost_pp_day ?? ""}"></label>
      <label>Wildlife months (e.g. 7,8,9)<input id="e-wild" value="${(idea.wildlife_months ?? []).join(",")}"></label>
    </div>
    <div class="error" id="e-error" hidden></div>
    <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="e-save">Save</button></div>`, (body) => {
    const v = (id) => body.querySelector(id).value.trim();
    const num = (s) => (s === "" ? null : Number(s));
    body.querySelector("#e-save").addEventListener("click", async () => {
      const wild = v("#e-wild") ? v("#e-wild").split(",").map((s) => Number(s.trim())).filter((n) => n >= 1 && n <= 12) : null;
      const patch = {
        title: v("#e-title"), kind: v("#e-kind"), season_basis: v("#e-basis"), description: v("#e-desc") || null,
        region: v("#e-region") || null, country_iso: v("#e-iso").toUpperCase() || null,
        lat: num(v("#e-lat")), lng: num(v("#e-lng")), cost_pp_day: num(v("#e-cost")), wildlife_months: wild,
      };
      try {
        upsertIdea(await api.updateIdea(idea.id, patch));
        dialog().close();
        toast("Saved.");
      } catch (err) {
        const e = body.querySelector("#e-error"); e.textContent = err.message; e.hidden = false;
      }
    });
  });
}

export function openSettings() {
  const s = state.settings;
  show(`<h2>Settings</h2>
    <div class="grid2">
      <label>Your name<input id="s-me" value="${esc(state.me.name)}" maxlength="40"></label>
      <label>${esc(state.other.name)}'s name<input id="s-other" value="${esc(state.other.name)}" maxlength="40"></label>
      <label>Departure date<input id="s-date" type="date" value="${esc(s.departure_date ?? "")}"></label>
      <label>Budget (€)<input id="s-budget" inputmode="numeric" value="${s.budget_eur}"></label>
      <label>Reserved for flights (€)<input id="s-flights" inputmode="numeric" value="${s.flight_reserve_eur}"></label>
    </div>
    <div class="error" id="s-error" hidden></div>
    <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="s-save">Save</button></div>`, (body) => {
    body.querySelector("#s-save").addEventListener("click", async () => {
      const v = (id) => body.querySelector(id).value.trim();
      try {
        const saved = await api.saveSettings({
          departure_date: v("#s-date") || undefined,
          budget_eur: Number(v("#s-budget")),
          flight_reserve_eur: Number(v("#s-flights")),
          names: { [state.me.id]: v("#s-me"), [state.other.id]: v("#s-other") },
        });
        update({
          settings: saved,
          me: { ...state.me, name: saved.names[state.me.id] },
          other: { ...state.other, name: saved.names[state.other.id] },
        });
        dialog().close();
        toast("Settings saved.");
      } catch (err) {
        const e = body.querySelector("#s-error"); e.textContent = err.message; e.hidden = false;
      }
    });
  });
}

export async function openBudget() {
  let b;
  try { b = await api.budget(); } catch (err) { return toast(err.message); }
  const fmt = (n) => `€${Math.round(n).toLocaleString("en-GB")}`;
  const text = b.dailyForTwo == null
    ? `<p>This fills in once you've both rated ideas 4★ or higher. It then averages their daily costs per country to estimate how long your budget lasts.</p>`
    : `<p>Ideas you both love (${b.qualifying}) average about <b>${fmt(b.dailyForTwo)}/day for two</b>.</p>
       <p>${fmt(b.budget)} minus ${fmt(b.flightReserve)} for flights covers about <b>${b.months ?? "?"} months</b>.</p>`;
  show(`<h2>Budget check</h2>${text}<p class="hint" style="color:var(--ink-faint);font-size:13px">A rough estimate: it uses per-country median costs and ignores route and timing. Change the budget in Settings.</p>
    <div class="foot"><button class="btn primary" data-close>Close</button></div>`, () => {});
}

export async function openLink() {
  let code;
  try { code = await api.linkCode(); } catch (err) { return toast(err.message); }
  show(`<h2>Link Telegram</h2>
    <p>Open your trip bot in Telegram and send:</p>
    <div class="code">/start ${esc(code.code)}</div>
    <p style="color:var(--ink-faint);font-size:13px">The code works once and expires in 15 minutes.</p>
    <div class="foot"><button class="btn" id="l-copy">Copy</button><button class="btn primary" data-close>Done</button></div>`, (body) => {
    body.querySelector("#l-copy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(`/start ${code.code}`); toast("Copied."); } catch { toast("Select the code and copy it."); }
    });
  });
}

export function openCountryNotes(iso) {
  show(`<h2>Notes on ${esc(countryName(iso))}</h2><div id="cn"></div><div class="foot"><button class="btn" data-close>Close</button></div>`, (body) => {
    renderNotes(body.querySelector("#cn"), { country: iso }, countryName(iso));
  });
}
```

- [ ] **Step 4: Register hooks in `app/js/main.js`**

Add imports at the top:

```js
import { renderCard } from "./card.js";
import { openAdd, openBudget, openCountryNotes, openLink, openSettings, setOpenIdea } from "./forms.js";
```

In `boot()`, directly after `hooks.onOpenIdea = openIdea;` add:

```js
    hooks.renderCard = renderCard;
    setOpenIdea(openIdea);
    hooks.onAction = (action) => {
      if (action === "add") openAdd();
      else if (action === "budget") openBudget();
      else if (action === "settings") openSettings();
      else if (action === "link") openLink();
      else if (action === "country-notes") openCountryNotes(state.view.iso);
    };
    subscribe(() => globe.setIdeas(state.ideas));
```

- [ ] **Step 5: Check by hand (local, seed data)**

Run `npm run dev`, then:
1. Open the Zermatt idea: month strip shows weather (all poor/borderline for the cold seed) and price rows; tapping a month shows the temperatures; the departure month is underlined.
2. Rate it 4★ as A: "Traveller B — Not rated yet". In a second browser profile add the header via devtools override or set `DEV_USER_EMAIL=b@example.com` in `.dev.vars` and restart: B sees "Rate it to see Traveller A's stars" until B rates (Review Focus 2).
3. Post a note; it appears in the thread (the Telegram ping fails silently locally because the token is `dev`; check the dev console shows "note ping failed").
4. Edit the title to `<b>x</b> & co`: it shows literally, not bold (Review Focus 3).
5. Mark as must-do: the pin becomes a star.
6. Settings: change names and departure date; header updates.
7. Budget check: after both rate an idea ≥ 4★, shows €/day and months.
8. Phone width (390 px): bottom sheet expands on idea open; dialogs fit the screen.

- [ ] **Step 6: Commit**

```bash
git add app && git commit -m "feat: idea card with month strip, blind ratings, notes, edit and settings dialogs"
```

---

### Task 10: Setup script, setup guide and first deploy

**Files:**
- Create: `scripts/setup.mjs`, `docs/setup.md`
- Modify: `wrangler.jsonc` (real `database_id`, written by the script)

**Interfaces:**
- Consumes: everything above.
- Produces: `npm run setup -- <step>` with steps `cloudflare`, `travellers`, `secrets`, `webhook`.

- [ ] **Step 1: `scripts/setup.mjs`**

```js
// One-time setup. Personal details go straight into Cloudflare (D1 / secrets), never into files in this repo.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const rl = readline.createInterface({ input, output });
const ask = async (q) => (await rl.question(q)).trim();
const sh = (cmd, opts = {}) => execSync(cmd, { stdio: ["pipe", "pipe", "inherit"], encoding: "utf8", ...opts });
const sql = (s) => `'${String(s).replace(/'/g, "''")}'`;
const d1 = (command) => sh(`npx wrangler d1 execute wereldreis --remote --command ${JSON.stringify(command)}`);
const secret = (name, value) => sh(`npx wrangler secret put ${name}`, { input: value });

const steps = {
  async cloudflare() {
    const out = sh("npx wrangler d1 create wereldreis");
    const id = out.match(/"database_id":\s*"([0-9a-f-]{36})"/)?.[1] ?? out.match(/database_id\s*=\s*"([0-9a-f-]{36})"/)?.[1];
    if (!id) throw new Error(`Could not find the database id in:\n${out}`);
    const cfg = readFileSync("wrangler.jsonc", "utf8").replace(/"database_id":\s*"[^"]*"/, `"database_id": "${id}"`);
    writeFileSync("wrangler.jsonc", cfg);
    sh("npx wrangler r2 bucket create wereldreis-photos");
    sh("npx wrangler d1 migrations apply wereldreis --remote", { input: "y\n" });
    console.log(`Database ${id} created, migrated, and written to wrangler.jsonc. Commit that change.`);
  },

  async travellers() {
    const a = await ask("Your first name: ");
    const aEmail = await ask("Your email (used for the login code): ");
    const b = await ask("Your travel partner's first name: ");
    const bEmail = await ask("Their email: ");
    const date = await ask("Departure date (YYYY-MM-DD): ");
    const budget = await ask("Budget in euros (e.g. 50000): ");
    const flights = await ask("Amount reserved for flights in euros (e.g. 5000): ");
    d1(
      `INSERT INTO users (id, name, email) VALUES ('a', ${sql(a)}, ${sql(aEmail)}), ('b', ${sql(b)}, ${sql(bEmail)}) ` +
        `ON CONFLICT (id) DO UPDATE SET name = excluded.name, email = excluded.email;`,
    );
    d1(
      `INSERT INTO settings (key, value) VALUES ('departure_date', ${sql(date)}), ('budget_eur', ${sql(Number(budget))}), ('flight_reserve_eur', ${sql(Number(flights))}) ` +
        `ON CONFLICT (key) DO UPDATE SET value = excluded.value;`,
    );
    console.log("Travellers and trip settings saved in the Cloudflare database.");
  },

  async secrets() {
    secret("TELEGRAM_BOT_TOKEN", await ask("Telegram bot token (from @BotFather): "));
    secret("ANTHROPIC_API_KEY", await ask("Anthropic API key: "));
    secret("APP_URL", (await ask("App address (e.g. https://wereldreis.yourname.workers.dev): ")).replace(/\/$/, ""));
    secret("ACCESS_TEAM_DOMAIN", await ask("Cloudflare Access team domain (e.g. yourteam.cloudflareaccess.com): "));
    secret("ACCESS_AUD", await ask("Access application audience (AUD) tag: "));
    secret("TELEGRAM_WEBHOOK_SECRET", randomBytes(24).toString("hex"));
    console.log("Secrets stored. Run `npm run setup -- webhook` next.");
  },

  async webhook() {
    const token = await ask("Telegram bot token (again, it is not readable back from Cloudflare): ");
    const appUrl = (await ask("App address: ")).replace(/\/$/, "");
    const webhookSecret = randomBytes(24).toString("hex");
    secret("TELEGRAM_WEBHOOK_SECRET", webhookSecret);
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: `${appUrl}/telegram`, secret_token: webhookSecret, allowed_updates: ["message", "callback_query"] }),
    });
    console.log(await res.json());
  },
};

const step = process.argv[2];
if (!steps[step]) {
  console.log("Usage: npm run setup -- cloudflare | travellers | secrets | webhook");
  process.exit(1);
}
try {
  await steps[step]();
} finally {
  rl.close();
}
```

- [ ] **Step 2: `docs/setup.md`** (written for the travellers; plain language)

````markdown
# Setting up your own Wereldreis globe

About 30 minutes, once. You need a computer with Node.js 20+ and this repository cloned.

## 1. Accounts (free)
1. **Cloudflare:** sign up at dash.cloudflare.com.
2. **Telegram bot:** in Telegram, open **@BotFather**, send `/newbot`, pick a name. Copy the token it gives you.
3. **Anthropic API key:** at console.anthropic.com → API keys → Create key. Add a small amount of credit (a few euros lasts a long time).

## 2. Cloudflare resources
```bash
npm install
npx wrangler login
npm run setup -- cloudflare
git add wrangler.jsonc && git commit -m "chore: set D1 database id" && git push
```

## 3. Connect GitHub so every push deploys
Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository** → pick this repo. Build command: none. Deploy command: `npx wrangler deploy`. After the first deploy, note the address (`https://wereldreis.<your-subdomain>.workers.dev`).

## 4. Login for just the two of you (Cloudflare Access)
1. Dashboard → **Workers & Pages** → **wereldreis** → **Settings** → **Domains & Routes** → on the `workers.dev` row, **Enable Cloudflare Access**.
2. Go to **Zero Trust** → **Access** → **Applications** → open the new application → **Policies**: allow only your two email addresses ("Emails" selector). Login method: **One-time PIN**.
3. In the same application, copy the **Application Audience (AUD) tag**. Your **team domain** is shown under Zero Trust → Settings → Custom Pages (`<team>.cloudflareaccess.com`).
4. **Add another application** (Self-hosted) for the same hostname with path `/telegram`, policy action **Bypass**, include **Everyone**. Telegram has to reach this path; the bot checks its own secret.

## 5. Your details and secrets
```bash
npm run setup -- travellers   # names, emails, departure date, budget (stored only in Cloudflare)
npm run setup -- secrets      # bot token, API key, app address, Access team domain + AUD
npm run setup -- webhook      # connects the Telegram bot to your app
```

## 6. Try it
1. Open the app address on your phone, enter your email, type the code you receive.
2. Tap **Link Telegram**, send the shown `/start 123456` to your bot.
3. Send the bot "Diving with mantas in Komodo". It appears on the globe a few seconds later.
````

- [ ] **Step 3: Run the full test suite once more**

Run: `npm test && npm run typecheck`
Expected: all PASS.

- [ ] **Step 4: Commit and push**

```bash
git add scripts/setup.mjs docs/setup.md && git commit -m "docs: one-time setup script and guide" && git push
```

- [ ] **Step 5: Guided setup with the travellers**

Walk the user through `docs/setup.md` live. Steps that need them: account sign-ups, `wrangler login` (browser), the Access dashboard clicks, typing personal details into `npm run setup -- travellers`. Never paste their answers into chat logs or files.

- [ ] **Step 6: End-to-end check on both phones** (spec §15 manual run)
1. Both log in with their email code.
2. Both link Telegram.
3. A sends an idea via Telegram → appears on the globe on B's phone after reload.
4. A rates it via the Telegram buttons → B's card says "Rate it to see A's stars"; B rates → both see both.
5. B leaves a note → A gets a Telegram ping with an "Open" button that opens the idea.
6. Undo within 10 minutes removes an idea; after 10 minutes the bot says to delete it in the app.
7. Budget check shows a number once both rated ideas ≥ 4★.
8. Visiting the app address in a private window without logging in shows the Cloudflare login page, never data.
````
