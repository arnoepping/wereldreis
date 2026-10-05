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
