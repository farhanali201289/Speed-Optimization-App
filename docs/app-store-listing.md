# Shopify App Store listing — Speed Optimization

Copy each block into the matching field in Partner Dashboard → Apps → Speed Optimization → Distribution → App Store listing. Character counts are already within Shopify's limits.

## Basic app information

**App name** (18/30)

```
Speed Optimization
```

**App icon:** `docs/listing/app-icon.png` (1200×1200)

**Pricing:** Free

**Primary language:** English

## App introduction (99/100)

```
Test your store with Google PageSpeed Insights and apply safe, reversible speed fixes in one click.
```

## App details (467/500)

```
Speed Optimization tests any page of your store with Google PageSpeed Insights and shows the mobile or desktop score, Core Web Vitals (LCP, FCP, TBT, CLS) and the issues slowing it down. It then recommends theme fixes: preload the LCP image, preconnect slow third-party origins, load icon CSS asynchronously and use font-display: swap. Apply them in one click and compare before/after results. Every edited theme file is backed up first, so you can roll back anytime.
```

## Features (max 80 characters each)

```
Run Google PageSpeed Insights tests on any store page, mobile or desktop
```

```
See Core Web Vitals (LCP, FCP, TBT, CLS) and what is slowing your store
```

```
One click: test, apply safe theme fixes, re-test and compare results
```

```
Preview every theme change before it is applied
```

```
Automatic backup of every edited file with one-click rollback
```

## Feature media

`docs/listing/feature-media.png` (1600×900). Alt text:

```
Speed Optimization dashboard with one-click speed boost and before/after PageSpeed scores
```

## Screenshots (desktop, 1600×900, 3–6 images)

Ready-made 1600×900 screenshots of the real app UI (Polaris components, demo data) are in `docs/listing/screenshot-1.png` … `screenshot-4.png`. Retake them from the live app any time with the same content:

| # | What to show | Alt text |
| --- | --- | --- |
| 1 | Dashboard top: "One-click speed boost" with the "Last optimization" before/after box | One-click speed boost with before and after PageSpeed scores |
| 2 | "2. Result": performance score, metrics table (FCP, LCP, TBT, CLS, Speed Index) and issues list | PageSpeed Insights result with Core Web Vitals and issues |
| 3 | "3. Theme fixes (advanced)": fix cards with Recommended badges and the theme selector | Recommended theme fixes with risk levels and theme selector |
| 4 | Preview banner after clicking "Preview changes" (shows which files will change) | Preview of theme files the fixes will change |
| 5 | History page: applied optimizations with Rollback buttons and the speed test table | History of optimizations with one-click rollback |

Screenshots must show the real app UI; don't add claims like guaranteed scores.

## Web search content

**Title tag** (54/60)

```
Speed Optimization – PageSpeed & Core Web Vitals Fixes
```

**Meta description** (145/160)

```
Test your store with Google PageSpeed Insights and apply safe, reversible theme fixes for LCP, render-blocking CSS and font loading in one click.
```

**Search terms** (up to 5)

```
page speed
core web vitals
lighthouse
store speed
lcp
```

## URLs

| Field | URL |
| --- | --- |
| Privacy policy | https://speed-optimization.neximet.com/privacy |
| App URL | https://speed-optimization.neximet.com |
| Support email | farhanali.fka@gmail.com |
| Demo store (optional) | https://forth.store |

## Testing instructions (App review)

```
Speed Optimization needs no login, account or payment — it is free and works right after install.

Scopes: read_themes and write_themes. The app reads theme files to find performance issues and writes small, reversible changes (async loading for icon CSS, font-display: swap). The LCP-image preload and preconnect tags are added through a theme app extension (the "Speed Optimizer" app embed), not by editing theme code. Every edited file is backed up in our database before it is changed and can be restored from the History page.

Steps:
1. Install the app and open it from the Apps menu. The Dashboard loads. Click "Enable app embed" in the yellow banner: the theme editor opens with the Speed Optimizer app embed turned on — click Save, then return to the app.
2. Note: if the development store has a storefront password, Google PageSpeed Insights tests the password page. The flow still works end to end; for realistic results, disable the password in Online Store > Preferences.
3. In "One-click speed boost", click "Speed up my store". The app (1) runs a PageSpeed test, (2) applies the low-risk recommended fixes to the live theme with a backup, (3) re-tests. This takes 1–2 minutes. A "Last optimization" box then shows the before/after score and metrics.
4. Scroll to "2. Result" to see the score, Core Web Vitals and the issues PageSpeed found.
5. In "3. Theme fixes (advanced)", choose a theme (an unpublished copy is fine), tick fixes and click "Preview changes" — the banner lists the files that will change. Click "Apply to theme" to apply them.
6. Open "History" in the app navigation and click "Rollback" on the latest optimization. The theme files are restored from the backup and the app embed's preload/preconnect settings go back to their previous values.
7. Uninstalling the app deletes the access token immediately; all store data is deleted when Shopify sends shop/redact.

The app stores no customer data. Support: farhanali.fka@gmail.com
```

## Screencast (required)

I can't record or upload a video for you. Record it yourself (Windows: Win + Alt + R with Xbox Game Bar, or Loom), upload it to YouTube as **Unlisted**, and paste the link into "Screencast URL". Keep it 2–4 minutes, in English, with no music needed.

Script:

1. **0:00** — Start on the dev store admin: Settings → Apps → show the app is not installed. Open the install link and click **Install** (shows the theme permission screen).
2. **0:20** — App opens on the Dashboard. Say: "Speed Optimization tests your store with Google PageSpeed Insights and applies safe theme fixes."
3. **0:35** — Click **Speed up my store**. Show the 3 steps progressing (test → apply fixes → re-test).
4. **1:30** — Show the **Last optimization** box: before/after score and metrics table.
5. **1:50** — Scroll to **2. Result** (score, Core Web Vitals, issues).
6. **2:10** — In **3. Theme fixes**, pick an unpublished theme, click **Preview changes**, show the banner listing files.
7. **2:30** — Go to **Online Store → Themes → Edit code** and open `snippets/speed-optimizer.liquid` to show the change the app made.
8. **2:50** — Open **History**, click **Rollback**, show the "Rolled back" toast.
9. **3:10** — End.

## Before you submit

- Run `npm run deploy` from your machine so Shopify receives the compliance webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) and URLs from `shopify.app.toml`.
- **write_themes is a protected scope for App Store apps.** Request access in Partner Dashboard (API access → "Theme modification" / write_themes exemption) and explain: the app edits theme files only on the merchant's explicit action, backs up every file, and supports rollback. Without this approval the app can't be listed.
- Add the app icon (1200×1200) and pick the app category (Store design → Page speed / Store management).
- Make sure the VPS `.env` has the new Client ID and secret, and the app is deployed.
