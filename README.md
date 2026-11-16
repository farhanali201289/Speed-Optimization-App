# Speed Optimizer — Shopify App

An embedded Shopify app (React Router + Polaris web components) that:

1. Runs a **Google PageSpeed Insights** test on any page of the store (mobile/desktop).
2. **Recommends fixes** based on the result (FCP, LCP, TBT, CLS, Speed Index and failing audits).
3. **One-click "Speed up my store"**: tests, applies the safe fixes to the live theme, re-tests, and shows the before/after score.
4. Lets you **preview and apply** individual fixes to any theme (live or an unpublished copy).
5. Saves a **backup** of every original file before changing it, with one-click **rollback** from the History page.

## Fixes

| Fix | Metric | What it does | One-click |
| --- | --- | --- | --- |
| Preload LCP image | LCP | `<link rel="preload" fetchpriority="high">` for PSI's LCP image, on the tested page and device size | ✅ |
| Preconnect | FCP, LCP | Third-party origins PSI flagged on the critical path (max 4) | ✅ |
| Async non-critical CSS | FCP | Only icon/animation/popup CSS (e.g. font-awesome); layout CSS is untouched | ✅ |
| Lazy media | LCP, SI | `loading="lazy"` on `<img>`/`<iframe>` in sections/snippets (hero/header skipped) | ✅ |
| font-display | FCP | `font-display: swap` in `@font-face` and the `font_face` filter | ✅ |
| Defer JS | FCP, TBT | `defer` on external scripts in `layout/theme.liquid` (jQuery skipped) | Manual only (medium risk) |

Preconnect/preload tags go into `snippets/speed-optimizer.liquid`, rendered at the top of `<head>`.

## Local setup

```bash
npm install
cp .env.example .env   # add PAGESPEED_API_KEY
npm run config:link    # link to your Partner Dashboard app
npm run dev
```

- Scopes: `read_themes,write_themes`.
- A **public (App Store) app** needs an exemption from Shopify for `write_themes`. Custom-distribution apps don't.
- On a password-protected dev store, PSI tests the password page — remove the password before testing.

## VPS deploy (speed-optimization.neximet.com)

On an Ubuntu VPS with Node 22+:

```bash
git clone https://github.com/farhanali201289/Speed-Optimization-App.git && cd Speed-Optimization-App
cp .env.example .env    # fill in SHOPIFY_API_SECRET and PAGESPEED_API_KEY
npm install && npm run setup && npm run build
set -a && . ./.env && set +a && pm2 start npm --name speed-optimizer -- start && pm2 save
```

Nginx: `proxy_pass http://127.0.0.1:3000;` with Host and X-Forwarded-Proto headers, plus `proxy_read_timeout 180s;` (speed tests can take over 60 seconds). SSL: `certbot --nginx -d speed-optimization.neximet.com`.

After changing URLs or scopes, run `npm run deploy` from your machine to push the config to Shopify. To install on a store: Partner Dashboard → Distribution → Custom distribution → install link.

Deploying an update (from Windows just run `scripts\deploy.cmd`). The script runs this app on its own Node 22 in `/opt/node22`, so the server's system Node and other PM2 apps are untouched:

```bash
cd /var/www/Speed-Optimization-App && git pull && bash scripts/vps-deploy.sh
```

`prisma/dev.sqlite` holds the theme backups — don't delete it.

## Files

- `app/services/pagespeed.server.ts` — PSI API call and result parsing
- `app/services/theme.server.ts` — Admin GraphQL theme file read/write/delete
- `app/services/optimizer.server.ts` — fix planning, apply and rollback
- `app/services/speed.server.ts` — shared action handler (test, preview, apply, one-click optimize)
- `app/fixes.ts` — fix catalog and recommendation logic
- `app/routes/app._index.tsx` — dashboard (one-click boost, test, results, fixes)
- `app/routes/app.api.tsx` — JSON endpoint for the one-click flow
- `app/routes/app.history.tsx` — test history and rollback
