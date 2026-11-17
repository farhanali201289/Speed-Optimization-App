// Plans and applies theme file fixes based on PSI audits.
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { FIXES, type FixId } from "../fixes";
import type { Audit } from "./pagespeed.server";
import {
  deleteThemeFiles,
  readThemeFiles,
  writeThemeFiles,
  type ThemeFile,
} from "./theme.server";
import {
  EMBED_LABEL,
  EMPTY_HEAD_CONFIG,
  HEAD_CONFIG_FILE,
  getHeadConfig,
  mergeHeadConfig,
  setHeadConfig,
  type HeadConfig,
} from "./head-config.server";

const LAYOUT = "layout/theme.liquid";
// Written by older versions of the app; still skipped by lazy-media and removed on rollback.
const SNIPPET = "snippets/speed-optimizer.liquid";

// These files are above the fold; lazy-loading their images hurts LCP.
const ABOVE_FOLD_FILE =
  /(hero|banner|slideshow|slider|header|logo|announcement|carousel|main-product|featured-product|product-template|productpage|product-main|image-with-text-overlay)/i;
// Only CSS that doesn't build the page layout (icons, animations, popups) is made async.
// Making layout CSS (theme, responsive, bootstrap, custom) async renders a broken page and raises CLS.
const NON_CRITICAL_CSS =
  /(font-?awesome|fontawesome|icons?|animate|aos|fancybox|lightbox|magnific|photoswipe|slick-theme|owl\.theme|glightbox)[^/]*\.css/i;

export interface FixReport {
  id: FixId;
  title: string;
  files: string[];
  notes: string[];
}

export interface Plan {
  changes: ThemeFile[];
  createdFiles: string[];
  originals: ThemeFile[];
  reports: FixReport[];
  // New app embed settings (preconnect/preload), or null when they don't change.
  head: { ownerId: string; before: string | null; after: string } | null;
}

interface PlanInput {
  fixes: FixId[];
  audits: Audit[];
  testedUrl: string;
  storeUrl: string;
  strategy: "mobile" | "desktop";
}

export function findLcpImage(audits: Audit[]): string | null {
  const lcpIds = [
    "largest-contentful-paint-element",
    "lcp-discovery-insight",
    "prioritize-lcp-image",
  ];
  for (const audit of audits.filter((a) => lcpIds.includes(a.id))) {
    for (const item of audit.items) {
      // item.url holds the full (untruncated) URL resolved in pagespeed.server.ts.
      const url = item.url?.replace(/&amp;/g, "&");
      if (url && !url.includes("…") && /\.(jpe?g|png|webp|avif|gif)(\?|$)|\/cdn\/shop\//i.test(url)) {
        return url.startsWith("//") ? `https:${url}` : url;
      }
    }
  }
  return null;
}

function auditUrls(audits: Audit[], ids: string[]): string[] {
  return audits
    .filter((a) => ids.includes(a.id))
    .flatMap((a) => a.items.map((i) => i.url))
    .filter((u): u is string => !!u && /^https?:/.test(u));
}

function filesFor(fixes: FixId[]): string[] {
  const names = new Set([LAYOUT]);
  if (fixes.includes("lazy-media")) {
    names.add("sections/*.liquid");
    names.add("snippets/*.liquid");
  }
  if (fixes.includes("font-display")) {
    names.add("assets/*.css");
    names.add("assets/*.css.liquid");
    names.add("snippets/*.liquid");
  }
  return [...names];
}

export async function planFixes(
  admin: AdminApiContext,
  themeId: string,
  input: PlanInput,
): Promise<Plan> {
  const files = await readThemeFiles(admin, themeId, filesFor(input.fixes));
  const originals = new Map(files.map((f) => [f.filename, f.content]));
  const current = new Map(originals);
  const reports: FixReport[] = [];

  if (!current.has(LAYOUT)) {
    throw new Error("layout/theme.liquid was not found in this theme.");
  }

  const edit = (report: FixReport, filename: string, next: string) => {
    if (next !== current.get(filename)) {
      current.set(filename, next);
      if (!report.files.includes(filename)) report.files.push(filename);
    }
  };

  // Preconnect/preload don't touch theme code: they go to the app embed's settings.
  const headAdd: HeadConfig = { preconnects: [], preloads: [] };
  const headFixes = new Set<FixId>();

  for (const fix of FIXES.filter((f) => input.fixes.includes(f.id))) {
    const report: FixReport = { id: fix.id, title: fix.title, files: [], notes: [] };
    reports.push(report);

    switch (fix.id) {
      case "preconnect": {
        // Only third-party origins PSI flagged on the critical path; the store's own domain is already connected.
        const storeOrigin = new URL(input.storeUrl).origin;
        const testedOrigin = new URL(input.testedUrl).origin;
        // Fonts load via CORS and need crossorigin; CSS/JS connections don't.
        const origins = new Map<string, boolean>();
        for (const url of auditUrls(input.audits, fix.auditIds)) {
          const origin = new URL(url).origin;
          if (origin === storeOrigin || origin === testedOrigin) continue;
          const isFont = /\.(woff2?|ttf|otf)(\?|$)/i.test(url);
          origins.set(origin, (origins.get(origin) ?? false) || isFont);
        }
        // More than 4 preconnects does more harm than good.
        for (const [origin, cors] of [...origins].slice(0, 4)) {
          headAdd.preconnects.push({ href: origin, cors });
          headFixes.add(fix.id);
          report.notes.push(`preconnect: ${origin}`);
        }
        if (!origins.size) report.notes.push("No slow third-party origins found.");
        break;
      }

      case "preload-lcp": {
        const image = findLcpImage(input.audits);
        if (!image) {
          report.notes.push("No LCP image found in the PSI result (the LCP element may be text).");
          break;
        }
        const path = new URL(input.testedUrl).pathname;
        // Themes load different image sizes on mobile and desktop, so preload only for the tested device.
        const media =
          input.strategy === "desktop" ? "(min-width: 768px)" : "(max-width: 767px)";
        headFixes.add(fix.id);
        headAdd.preloads.push({ path, href: image, media });
        report.notes.push(`LCP image (${input.strategy}): ${image}`);
        report.notes.push(
          "If you change this page's hero image, run the speed test and this fix again.",
        );
        break;
      }

      case "defer-js": {
        let layout = current.get(LAYOUT)!;
        let count = 0;
        layout = layout.replace(/<script\b([^>]*)>/gi, (tag, attrs: string) => {
          if (!/\bsrc\s*=/.test(attrs)) return tag;
          if (/\b(defer|async)\b|type\s*=\s*["']?module|jquery/i.test(attrs)) return tag;
          count++;
          return `<script${attrs} defer>`;
        });
        layout = layout.replace(
          /\{\{-?\s*('[^']+\.js'|"[^"]+\.js")\s*\|\s*asset_url\s*\|\s*script_tag\s*-?\}\}/g,
          (tag, name: string) => {
            if (/jquery/i.test(name)) return tag;
            count++;
            return `<script src="{{ ${name} | asset_url }}" defer></script>`;
          },
        );
        edit(report, LAYOUT, layout);
        report.notes.push(`Added defer to ${count} script tag(s).`);
        break;
      }

      case "async-css": {
        const blocking = auditUrls(input.audits, fix.auditIds).filter((u) =>
          /\.css(\?|$)/.test(u),
        );
        const blockingNames = new Set(
          blocking.map((u) => new URL(u).pathname.split("/").pop()!),
        );
        const isBlocking = (href: string) =>
          blocking.some((u) => u.includes(href.replace(/^https?:/, "")));
        let count = 0;
        let layout = current.get(LAYOUT)!;
        // {{ 'icons.css' | asset_url | stylesheet_tag }}
        layout = layout.replace(
          /\{\{-?\s*['"]([^'"]+\.css)['"]\s*\|\s*asset_url\s*\|\s*stylesheet_tag\s*-?\}\}/g,
          (tag, name: string) => {
            if (!NON_CRITICAL_CSS.test(name) || !blockingNames.has(name)) return tag;
            count++;
            return `<link rel="stylesheet" href="{{ '${name}' | asset_url }}" media="print" onload="this.media='all'"><noscript>{{ '${name}' | asset_url | stylesheet_tag }}</noscript>`;
          },
        );
        // {{ 'https://cdn.com/font-awesome.css' | stylesheet_tag }}
        layout = layout.replace(
          /\{\{-?\s*['"]((?:https?:)?\/\/[^'"]+\.css[^'"]*)['"]\s*\|\s*stylesheet_tag\s*-?\}\}/g,
          (tag, href: string) => {
            if (!NON_CRITICAL_CSS.test(href) || !isBlocking(href)) return tag;
            count++;
            return `<link rel="stylesheet" href="${href}" media="print" onload="this.media='all'"><noscript>${tag}</noscript>`;
          },
        );
        // <link rel="stylesheet" href="https://cdn.com/font-awesome.css">
        layout = layout.replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi, (tag) => {
          const href = tag.match(/href=["']([^"']+)["']/)?.[1];
          if (!href || /\bmedia=|onload=/.test(tag)) return tag;
          if (!NON_CRITICAL_CSS.test(href) || !isBlocking(href)) return tag;
          count++;
          return tag.replace(/\s*\/?>$/, ` media="print" onload="this.media='all'">`);
        });
        edit(report, LAYOUT, layout);
        report.notes.push(
          count
            ? `Made ${count} stylesheet(s) async.`
            : "No non-critical render-blocking stylesheet found in theme.liquid.",
        );
        break;
      }

      case "lazy-media": {
        let count = 0;
        for (const [filename, content] of current) {
          if (!/^(sections|snippets)\/.+\.liquid$/.test(filename)) continue;
          if (filename === SNIPPET || ABOVE_FOLD_FILE.test(filename)) continue;
          const next = content.replace(/<(img|iframe)\b([^>]*)>/gi, (tag, el, attrs: string) => {
            if (/\bloading\s*=/.test(attrs) || /fetchpriority/.test(attrs)) return tag;
            count++;
            return `<${el} loading="lazy"${attrs}>`;
          });
          edit(report, filename, next);
        }
        report.notes.push(`Lazy-loaded ${count} image/iframe tag(s).`);
        break;
      }

      case "font-display": {
        let count = 0;
        for (const [filename, content] of current) {
          if (!/^(assets\/.+\.css(\.liquid)?|snippets\/.+\.liquid|layout\/theme\.liquid)$/.test(filename)) continue;
          let next = content.replace(/@font-face\s*\{([^}]*)\}/g, (block, body: string) => {
            if (/font-display/.test(body)) return block;
            count++;
            return `@font-face {font-display: swap;${body}}`;
          });
          next = next.replace(/\|\s*font_face\b(?!\s*:)/g, () => {
            count++;
            return "| font_face: font_display: 'swap'";
          });
          edit(report, filename, next);
        }
        report.notes.push(`Updated ${count} font declaration(s).`);
        break;
      }
    }
  }

  let head: Plan["head"] = null;
  if (headFixes.size) {
    const { ownerId, raw, config } = await getHeadConfig(admin);
    const after = JSON.stringify(mergeHeadConfig(config, headAdd));
    if (after !== JSON.stringify(mergeHeadConfig(config, EMPTY_HEAD_CONFIG))) {
      head = { ownerId, before: raw, after };
      // Credit the app embed to these fixes so History and the before/after summary list them.
      for (const report of reports.filter((r) => headFixes.has(r.id))) {
        report.files.push(EMBED_LABEL);
      }
    }
  }

  const changes = [...current]
    .filter(([name, content]) => originals.get(name) !== content)
    .map(([filename, content]) => ({ filename, content }));

  return {
    changes,
    createdFiles: [],
    originals: changes
      .filter((c) => originals.has(c.filename))
      .map((c) => ({ filename: c.filename, content: originals.get(c.filename)! })),
    reports,
    head,
  };
}

export async function applyPlan(
  admin: AdminApiContext,
  shop: string,
  theme: { id: string; name: string },
  plan: Plan,
  speedTestId: string | null,
) {
  if (!plan.changes.length && !plan.head) return null;
  // The previous app embed settings are kept with the file backups, under a pseudo filename.
  const backups = plan.head
    ? [...plan.originals, { filename: HEAD_CONFIG_FILE, content: plan.head.before ?? "" }]
    : plan.originals;
  // Save the backup first, then write the theme, so a failed write can still be rolled back.
  const record = await prisma.optimization.create({
    data: {
      shop,
      themeId: theme.id,
      themeName: theme.name,
      fixes: JSON.stringify(plan.reports),
      backups: JSON.stringify(backups),
      createdFiles: JSON.stringify(plan.createdFiles),
      speedTestId,
    },
  });
  await writeThemeFiles(admin, theme.id, plan.changes);
  if (plan.head) await setHeadConfig(admin, plan.head.ownerId, plan.head.after);
  return record;
}

export async function rollback(admin: AdminApiContext, shop: string, id: string) {
  const record = await prisma.optimization.findFirst({ where: { id, shop } });
  if (!record || record.rolledBack) throw new Error("Optimization not found.");
  const newer = await prisma.optimization.count({
    where: { shop, themeId: record.themeId, rolledBack: false, createdAt: { gt: record.createdAt } },
  });
  if (newer) {
    throw new Error("Roll back newer optimizations on this theme first (start with the latest).");
  }

  const backups: ThemeFile[] = JSON.parse(record.backups);
  const created: string[] = JSON.parse(record.createdFiles);
  const headBackup = backups.find((b) => b.filename === HEAD_CONFIG_FILE);
  // Restore the layout before deleting the snippet, or its render tag would break.
  await writeThemeFiles(admin, record.themeId, backups.filter((b) => b !== headBackup));
  await deleteThemeFiles(admin, record.themeId, created);
  if (headBackup) {
    const { ownerId } = await getHeadConfig(admin);
    await setHeadConfig(admin, ownerId, headBackup.content || JSON.stringify(EMPTY_HEAD_CONFIG));
  }

  await prisma.optimization.update({ where: { id }, data: { rolledBack: true } });
}
