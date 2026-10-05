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
