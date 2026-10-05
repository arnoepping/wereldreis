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
          "title",
          "kind",
          "description",
          "place_name",
          "country_iso",
          "lat",
          "lng",
          "cost_pp_day",
          "season_basis",
          "wildlife_months",
          "price_season",
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
};

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
