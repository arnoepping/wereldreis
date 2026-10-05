# Wereldreis Globe — Design

**Date:** 2026-10-05
**Status:** Approved in conversation; written spec approved

## 1. Purpose

Two travellers are saving for a long world trip with a roughly fixed budget (it may grow if they work while travelling). They want one private place to:

1. **Collect dreams** — capture places and activities the moment they come up, mostly from their phones.
2. **Shape the trip** — see where their ideas are, when each place is at its best (weather and price), how much they both like each idea, and roughly how long the budget lasts.

They explicitly do **not** want a fixed itinerary or timeline: they want to travel freely. Deciding happens in conversation; the app supports that conversation.

**Success looks like:** both travellers open it regularly on phone and laptop, adding an idea takes one Telegram message, and the globe gives an honest feel for "where, when, and can we afford it".

## 2. Privacy rule for this repository

The repository is **public and open source**. It contains **no personal data**: no names, email addresses, Telegram IDs, departure date, budget figures, ideas or notes.

- The two travellers' names, emails, and the trip settings (departure date, budget, flight reserve) live only in the private Cloudflare database, entered through a one-time setup step (§3) or the app's settings.
- Secrets (Telegram bot token, webhook secret, Anthropic API key) live only in Cloudflare secrets, and locally in `.dev.vars` (git-ignored).
- Code, tests and docs use neutral placeholders (`Traveller A`, `a@example.com`, `2030-01-01`).
- The only thing that identifies the deployment is its own URL, which isn't in the repo either.

## 3. Scope

### In version 1
- 3D globe with natural relief colours and satellite imagery at every zoom level; world → continent → country → idea drill-down.
- Ideas with location, description, source link/photo, author, must-do flag, best months (weather + price), rough cost, ratings, notes.
- Telegram bot to add ideas, with AI auto-fill and inline rating buttons.
- Blind 5-star ratings per traveller.
- Note threads on ideas and on countries, with a Telegram ping to the other traveller.
- Budget check panel.
- In-app form to add and edit ideas (backup for Telegram, and to correct the AI).
- Settings panel: traveller display names, departure date, budget, flight reserve.
- Login restricted to the two travellers.

### Not in version 1
- Timeline / planned months / itinerary (dropped by request).
- Categories and filters.
- Travel mode (marking ideas done, travel diary).
- Savings or bank integration.
- Sharing with others.

## 4. Architecture

Code lives in a **public GitHub repository**. Everything runs on **Cloudflare's free tier**, which deploys automatically from GitHub on every push to `main`.

```
Telegram (both travellers) ──► Telegram Bot API ──webhook──► Worker  /telegram
                                                               │
Phone / laptop ──► Cloudflare Access (email code) ──► Pages: globe app
                                                       │  fetch /api/*
                                                       ▼
                                                     Worker /api ──► D1 database
                                                       │
                                                       ├──► Claude API (enrichment)
                                                       ├──► Open-Meteo (climate)
                                                       └──► Telegram Bot API (replies, pings)
```

| Part | Technology | Responsibility |
|---|---|---|
| Globe app | Static site on Cloudflare Pages; MapLibre GL JS (globe projection) | All UI. Talks only to `/api`. |
| API + bot | One Cloudflare Worker (TypeScript), routed on the same hostname under `/api/*` and `/telegram` | REST API, Telegram webhook, enrichment, notifications. |
| Database | Cloudflare D1 (SQLite) | Users, ideas, ratings, notes, settings. |
| Photos | Cloudflare R2 | Photos sent to the bot. |
| Login | Cloudflare Access, one-time email code | Only the two allowed email addresses reach the app and `/api`. The Worker reads the verified email from the Access JWT and looks it up in `users`. |
| Enrichment | Claude API, `claude-opus-5-5`, structured JSON output, server-side `fallbacks: "default"` | Turn a free-text message or link into structured ideas. |
| Climate | Open-Meteo historical weather API | Monthly average daily min/max temperature per location. |

**Repository layout**

```
app/        globe front-end (static HTML/JS/CSS, map data, relief tiles)
worker/     Cloudflare Worker: api/, telegram/, enrich/, db/ (schema + migrations)
docs/       specs, plans, setup guide
```

**Running cost:** hosting €0. Claude API usage under €1 a month at the expected volume (tens of ideas a month). Optional custom domain about €10 a year; otherwise the free `*.pages.dev` / `*.workers.dev` addresses.

**One-time setup by the travellers** (with a step-by-step guide in `docs/setup.md`):
1. Create a free Cloudflare account and connect it to the GitHub repository.
2. Create a Telegram bot via @BotFather and copy its token.
3. Create an Anthropic API key.
4. Run the setup command, which asks for the two names, two email addresses, departure date and budget, and writes them **directly into the D1 database** (never into a file in the repo). It also stores the secrets and the Access policy.
5. Each traveller links their Telegram account once (§10).

## 5. Map

- **Zoom ≤ 5:** Natural Earth II relief tiles (land cover + shaded relief), self-hosted in `app/`, as in the prototype.
- **Zoom > 5:** Sentinel-2 cloudless satellite tiles from EOX's WMTS, cross-faded over the relief between zoom 5 and 6. Every country is sharp at every zoom. (Licence: CC BY-NC-SA 4.0. Private, non-commercial use; attribution shown in the panel footer.)
- **Vector overlays** (self-hosted Natural Earth): country borders at 10 m resolution, admin-1 regions, lakes.
- **Pins:** one colour per traveller (orange for traveller A, pink for traveller B); must-dos get a larger star-shaped pin.
- Drill-down, breadcrumb, side panel / bottom sheet behave as in the prototype.

## 6. Data model (D1)

```sql
users    (id TEXT PRIMARY KEY,          -- 'a' | 'b'
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          telegram_id INTEGER UNIQUE,
          link_code TEXT, link_code_expires TEXT)

ideas    (id INTEGER PRIMARY KEY,
          title TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('place','activity')),
          description TEXT,
          lat REAL, lng REAL,
          country_iso TEXT,     -- ISO 3166-1 alpha-3
          region TEXT,
          source_url TEXT, photo_key TEXT,
          added_by TEXT NOT NULL REFERENCES users(id),
          must_do INTEGER NOT NULL DEFAULT 0,
          cost_pp_day INTEGER,  -- euros per person per day
          season_basis TEXT NOT NULL CHECK (season_basis IN ('weather','wildlife')) DEFAULT 'weather',
          wildlife_months TEXT, -- JSON array of 1–12
          price_season TEXT,    -- JSON array of 12: 'low' | 'mid' | 'high'
          climate TEXT,         -- JSON array of 12 {min, max} in °C
          status TEXT NOT NULL CHECK (status IN ('ready','needs_details')) DEFAULT 'ready',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL)

ratings  (idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id),
          stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
          PRIMARY KEY (idea_id, user_id))

notes    (id INTEGER PRIMARY KEY,
          idea_id INTEGER REFERENCES ideas(id) ON DELETE CASCADE,
          country_iso TEXT,
          author TEXT NOT NULL REFERENCES users(id),
          body TEXT NOT NULL,
          created_at TEXT NOT NULL,
          CHECK ((idea_id IS NULL) <> (country_iso IS NULL)))

settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)
          -- 'departure_date' (YYYY-MM-DD), 'budget_eur', 'flight_reserve_eur'
```

## 7. Best months

Each idea shows a 12-month strip with **two separate marks** per month.

**Weather mark** (when `season_basis = 'weather'`), from the average daily minimum and maximum temperature for that month:
- **Good:** min ≥ 16 °C **and** max ≤ 30 °C.
- **Borderline:** not good, but min ≥ 14 °C and max ≤ 32 °C.
- **Poor:** everything else.
- **Unknown:** no climate data.

Climate data: Open-Meteo historical API, daily `temperature_2m_min` and `temperature_2m_max` at the idea's coordinates for the 10 most recent complete years, averaged per calendar month. Fetched when the idea is created or its location changes; stored in `ideas.climate`. Tapping a month shows the numbers ("Apr: 23–31 °C").

**Wildlife ideas** (`season_basis = 'wildlife'`): the weather mark is replaced by the sighting season from `wildlife_months` (good / poor). Set by the AI for wildlife activities; editable.

**Price mark:** `low` / `mid` / `high` season per month, estimated by the AI. Labelled "estimate" on the card; editable.

The strip marks the departure month (from `settings.departure_date`).

## 8. Ratings (blind)

- Each traveller can give an idea 1–5 stars and change it any time.
- The API returns the other traveller's rating **only if** the requesting traveller has rated that idea; otherwise `{ hidden: true }`, and the card says "Rate it to see <name>'s stars".
- The rule lives in the Worker. The app never receives a hidden rating.
- Telegram rating buttons (§10) follow the same rule: after you tap, the bot reveals the other's stars if they exist.

## 9. Notes and pings

- A note thread exists on every idea and on every country.
- Posting a note sends the **other** traveller a Telegram message: "<name> on *<idea title>*: <note>", with a link that opens the app on that idea or country.
- Unseen notes show a dot. "Seen" is tracked client-side (localStorage) in version 1; losing it only means dots reappear.

## 10. Telegram bot

**Linking accounts:** in the app, "Link Telegram" shows a one-time code valid for 15 minutes. Sending `/start <code>` to the bot stores that Telegram ID on the logged-in traveller. This is the only message accepted from an unknown Telegram ID.

**Allowed users:** only the two linked `telegram_id`s. Anything else is ignored silently. The webhook checks Telegram's `X-Telegram-Bot-Api-Secret-Token` header; `/telegram` is excluded from Cloudflare Access.

**Adding ideas**
1. A traveller sends text, a link, a photo with a caption, or a location pin.
2. The bot replies immediately: "Looking it up…".
3. Enrichment (§11) returns 0–n ideas, or one clarifying question.
4. For each idea the bot sends: "Added: **<title>** — <place>, <country> · good <months> · cheapest <months> · ~€<cost>/day", with buttons `⭐1 … ⭐5`, `Open on globe` and `Undo`.
5. If enrichment returns a clarifying question, the bot asks it and treats the next message from that traveller as the answer (the original text is kept and both are sent to enrichment).
6. If no place or activity is recognised, the bot says so and saves nothing.

**Commands:** `/start <code>`, `/help`.

**Undo** works for 10 minutes, only for the traveller who added the idea, and deletes it. After that, ideas are deleted in the app.

## 11. Enrichment

Input: message text, link (with page title/description fetched by the Worker when reachable), photo caption, or location pin.

The Worker calls the Claude API (`claude-opus-5-5`, `output_config.format` with a JSON schema, `fallbacks: "default"`) and gets back either a `clarifying_question` or a list of ideas, each with: `title`, `kind`, `description` (1–2 sentences), `place_name`, `country_iso`, `region`, `lat`, `lng`, `cost_pp_day`, `price_season[12]`, `season_basis`, `wildlife_months`.

Then the Worker fetches climate data (§7) and stores the ideas.

Failures:
- Claude API error, timeout or refusal → the idea is saved with the raw text as title, `status = 'needs_details'`, and the bot says "Saved, but I couldn't look it up. Fill in the details in the app."
- Open-Meteo error → `climate` stays null (weather marks show "unknown"); retried on the next edit of the idea.
- "Needs details" ideas are listed at the top of the world panel until fixed.

## 12. Budget check

A panel reachable from the world view:

- **Selection:** ideas both travellers rated **4★ or higher**.
- **Daily cost for two:** for each country in the selection, take the median `cost_pp_day` of its selected ideas (ideas without a cost are skipped); average those country values; multiply by 2.
- **Months covered:** `(budget_eur − flight_reserve_eur) / (daily_cost_for_two × 30.4)`, rounded to one decimal.
- **Display:** "Ideas you both love average about €X/day for two. €<budget> minus €<flights> for flights covers about N months." Budget and flight reserve are editable inline.
- With no qualifying ideas, the panel explains how it works and that it fills once both have rated.

Deliberately rough; the panel says so.

## 13. API (Worker, behind Access unless noted)

```
GET    /api/me                      → { id, name, other: { id, name }, telegram_linked }
POST   /api/telegram-link-code      → { code }  (one-time, 15 min)
GET    /api/ideas                   → ideas with ratings (blind-filtered) and note counts
POST   /api/ideas                   → create; ?enrich=1 runs AI enrichment on { text }
PATCH  /api/ideas/:id               → edit fields
DELETE /api/ideas/:id
PUT    /api/ideas/:id/rating        → { stars }
GET    /api/notes?idea=:id | ?country=:iso
POST   /api/notes                   → { idea_id | country_iso, body }  (triggers ping)
GET    /api/settings  · PATCH /api/settings
POST   /telegram                    → webhook (not behind Access; secret-token checked)
```

## 14. Error handling (summary)

- App: failed API calls show an inline message with a retry; the globe stays usable with the last loaded data.
- Bot: every failure produces a short Telegram reply.
- Unknown users (Access or Telegram) get nothing.

## 15. Testing

- **Unit (Vitest):** weather classification (including the 14/16 °C and 30/32 °C edges), blind-rating filter, budget calculation, enrichment output validation.
- **Worker integration (`@cloudflare/vitest-pool-workers` with a local D1):** API routes, and the Telegram webhook with fake update payloads (text, link, photo, ambiguous text, unknown user, bad secret). Claude, Open-Meteo and Telegram are stubbed.
- **Manual:** one end-to-end run on both phones: add an idea via Telegram, rate it blind from both sides, leave a note and receive the ping, check the budget panel.

## 16. Open points (decide during planning, not blocking)

- Custom domain, or the free `*.pages.dev` address.
- Where exactly the relief cross-fades into satellite.
