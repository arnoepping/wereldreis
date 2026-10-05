import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll } from "vitest";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";

beforeAll(async () => {
  const e = env as unknown as { DB: D1Database; TEST_MIGRATIONS: D1Migration[] };
  await applyD1Migrations(e.DB, e.TEST_MIGRATIONS);
});
