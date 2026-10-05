import { beforeEach, describe, expect, it } from "vitest";
import { addIdeasFromText } from "../src/ideas-service";
import * as db from "../src/db";
import type { Deps } from "../src/deps";
import { resetDb, testEnv } from "./helpers";
import { stubDeps } from "./stubs";

const never = () => new Promise<never>(() => {});
const FAST = { enrichMs: 50, climateMs: 50, previewMs: 50 };

describe("addIdeasFromText deadlines", () => {
  beforeEach(resetDb);

  it("saves a needs_details idea when enrichment hangs past its deadline", async () => {
    const deps = stubDeps({ enrich: never });
    const result = await addIdeasFromText(testEnv.DB, deps as Deps, "a", "Something slow", {}, FAST);
    expect(result.kind).toBe("failed");
    expect((await db.listIdeaRows(testEnv.DB))[0]).toMatchObject({ title: "Something slow", status: "needs_details" });
  });

  it("still saves the idea when the climate lookup hangs", async () => {
    const deps = stubDeps({ climate: never });
    const result = await addIdeasFromText(testEnv.DB, deps as Deps, "a", "Komodo", {}, FAST);
    expect(result.kind).toBe("ideas");
    expect((await db.listIdeaRows(testEnv.DB))[0].climate).toBeNull();
  });

  it("ignores a link preview that hangs", async () => {
    const deps = stubDeps({ linkPreview: never });
    const result = await addIdeasFromText(testEnv.DB, deps as Deps, "a", "https://slow.test/x", {}, FAST);
    expect(result.kind).toBe("ideas");
  });

  it("keeps the default worst case under Telegram's 30 s waitUntil budget", async () => {
    const { DEFAULT_DEADLINES, PHOTO_DOWNLOAD_MS } = await import("../src/ideas-service");
    const worst = PHOTO_DOWNLOAD_MS + DEFAULT_DEADLINES.previewMs + DEFAULT_DEADLINES.enrichMs + DEFAULT_DEADLINES.climateMs;
    expect(worst).toBeLessThanOrEqual(27_000);
  });
});
