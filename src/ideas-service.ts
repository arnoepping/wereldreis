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
