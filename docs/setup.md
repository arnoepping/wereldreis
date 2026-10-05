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
