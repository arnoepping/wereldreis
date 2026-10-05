import type { Deps } from "./deps";
import { insertIdea } from "./db";

const URL_RE = /https?:\/\/[^\s<>"]+/i;
export const firstUrl = (text: string): string | null => text.match(URL_RE)?.[0] ?? null;

// Telegram work runs in ctx.waitUntil, which Cloudflare stops ~30 s after the response.
// These deadlines keep the worst case (photo + preview + enrich + climate) under that budget,
// so a slow step ends as a "needs details" idea instead of a lost one.
export const DEFAULT_DEADLINES = { previewMs: 3_000, enrichMs: 15_000, climateMs: 4_000 };
export const PHOTO_DOWNLOAD_MS = 5_000;
export type Deadlines = typeof DEFAULT_DEADLINES;

export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

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
  deadlines: Deadlines = DEFAULT_DEADLINES,
): Promise<AddResult> {
  const now = () => deps.now().toISOString();
  const sourceUrl = extra.source_url ?? firstUrl(text);
  let input = text;
  if (sourceUrl) {
    const preview = await withTimeout(deps.linkPreview(sourceUrl), deadlines.previewMs, "link preview").catch(() => null);
    if (preview) input += `\n\nLink preview: ${preview}`;
  }

  let result;
  try {
    result = await withTimeout(deps.enrich(input), deadlines.enrichMs, "enrichment");
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

  const climates = await Promise.all(
    result.ideas.map((idea) => withTimeout(deps.climate(idea.lat, idea.lng), deadlines.climateMs, "climate").catch(() => null)),
  );
  const ids: number[] = [];
  for (const [i, idea] of result.ideas.entries()) {
    const climate = climates[i];
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
