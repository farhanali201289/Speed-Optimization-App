# Speed Optimizer — Shopify App

Shopify embedded app (React Router + Polaris web components) jo:

1. Store ke kisi bhi page par **Google PageSpeed Insights** test chalati hai (mobile/desktop).
2. Result (FCP, LCP, TBT, CLS, Speed Index + failing audits) ke hisab se **fixes recommend** karti hai.
3. Selected theme (live ya unpublished copy) ki Liquid/CSS files me **fixes apply** karti hai — pehle preview, phir apply.
4. Har change se pehle original files ka **backup** DB me rakhti hai aur History page se **rollback** hota hai.

## Fixes

| Fix | Metric | Kya karta hai |
| --- | --- | --- |
| LCP image preload | LCP | PSI ki LCP image ka `<link rel="preload" fetchpriority="high">` us page ke liye |
| Preconnect | FCP, LCP | Shopify CDN / fonts / slow third-party origins (max 4) |
| Defer JS | FCP, TBT | `layout/theme.liquid` ke external scripts par `defer` (jQuery skip) |
| Async CSS | FCP | PSI ki flagged non-critical stylesheets ko preload+onload |
| Lazy media | LCP, SI | Sections/snippets ki `<img>`/`<iframe>` par `loading="lazy"` (hero/header skip) |
| font-display | FCP | `@font-face` aur `font_face` filter me `font-display: swap` |

Preconnect/preload tags `snippets/speed-optimizer.liquid` me jate hain jo `<head>` ke shuru me render hota hai.

## Setup

```bash
npm install
cp .env.example .env   # PAGESPEED_API_KEY daalein
npm run config:link    # Partner Dashboard app se link
npm run dev
```

- Scopes: `read_themes,write_themes`.
- **Public (App Store) app** ke liye `write_themes` ke liye Shopify se exemption request karna padta hai. Custom app ke liye zaroori nahi.
- Password-protected dev store par PSI password page test karta hai — test se pehle password hata dein.

## VPS deploy (speed-optimization.neximet.com)

Ubuntu VPS par, Node 22+ ke sath:

```bash
git clone https://github.com/farhanali201289/Speed-Optimization-App.git && cd Speed-Optimization-App
cp .env.example .env    # SHOPIFY_API_SECRET aur PAGESPEED_API_KEY bharein
npm install && npm run setup && npm run build
set -a && . ./.env && set +a && pm2 start npm --name speed-optimizer -- start && pm2 save
```

Nginx `proxy_pass http://127.0.0.1:3000;` (Host aur X-Forwarded-Proto headers ke sath) aur `certbot --nginx -d speed-optimization.neximet.com`.

URL/scopes badlein to apne computer se `npm run deploy` chala kar config Shopify par bhejein. Store me install: Partner Dashboard → Distribution → Custom distribution → install link.

Update deploy karna:

```bash
git pull && npm install && npm run setup && npm run build
set -a && . ./.env && set +a && pm2 restart speed-optimizer --update-env
```

`prisma/dev.sqlite` me theme backups hain — ise delete na karein.

## Files

- `app/services/pagespeed.server.ts` — PSI API call aur result parsing
- `app/services/theme.server.ts` — Admin GraphQL theme file read/write/delete
- `app/services/optimizer.server.ts` — fixes ka plan, apply, rollback
- `app/fixes.ts` — fixes ka catalog aur recommendation logic
- `app/routes/app._index.tsx` — dashboard (test, result, fixes)
- `app/routes/app.history.tsx` — tests history aur rollback
