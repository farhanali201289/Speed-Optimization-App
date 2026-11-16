// PSI audits ke hisab se theme files me fixes plan aur apply karta hai.
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

const LAYOUT = "layout/theme.liquid";
const SNIPPET = "snippets/speed-optimizer.liquid";
const RENDER_TAG = "{%- render 'speed-optimizer' -%}";

// Ye files above-the-fold hoti hain, inki images lazy karne se LCP kharab hota hai.
const ABOVE_FOLD_FILE =
  /(hero|banner|slideshow|slider|header|logo|announcement|carousel|main-product|featured-product|image-with-text-overlay)/i;
// Sirf wo CSS async hoti hai jo page ka layout nahi banati (icons, animations, popups).
// Layout CSS (theme, responsive, bootstrap, custom) async karne se page toota hua dikhta hai aur CLS barhta hai.
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
      // item.url pagespeed.server.ts me poora (na kata hua) URL hota hai.
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
  const names = new Set([LAYOUT, SNIPPET]);
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
    throw new Error("Is theme me layout/theme.liquid nahi mili.");
  }

  const edit = (report: FixReport, filename: string, next: string) => {
    if (next !== current.get(filename)) {
      current.set(filename, next);
      if (!report.files.includes(filename)) report.files.push(filename);
    }
  };

  const headTags: string[] = [];

  for (const fix of FIXES.filter((f) => input.fixes.includes(f.id))) {
    const report: FixReport = { id: fix.id, title: fix.title, files: [], notes: [] };
    reports.push(report);

    switch (fix.id) {
      case "preconnect": {
        // Sirf wo third-party origins jo PSI ne critical path me pakde; store ka apna domain pehle se connected hota hai.
        const storeOrigin = new URL(input.storeUrl).origin;
        const testedOrigin = new URL(input.testedUrl).origin;
        // Fonts CORS se aate hain, unke connection ke liye crossorigin chahiye; CSS/JS ke liye nahi.
        const origins = new Map<string, boolean>();
        for (const url of auditUrls(input.audits, fix.auditIds)) {
          const origin = new URL(url).origin;
          if (origin === storeOrigin || origin === testedOrigin) continue;
          const isFont = /\.(woff2?|ttf|otf)(\?|$)/i.test(url);
          origins.set(origin, (origins.get(origin) ?? false) || isFont);
        }
        // 4 se zyada preconnect ulta nuqsan karte hain.
        for (const [origin, cors] of [...origins].slice(0, 4)) {
          headTags.push(`<link rel="preconnect" href="${origin}"${cors ? " crossorigin" : ""}>`);
          report.notes.push(`preconnect: ${origin}`);
        }
        if (!origins.size) report.notes.push("Koi slow third-party origin nahi mila.");
        break;
      }

      case "preload-lcp": {
        const image = findLcpImage(input.audits);
        if (!image) {
          report.notes.push("PSI result me LCP image nahi mili (shayad LCP text hai).");
          break;
        }
        const path = new URL(input.testedUrl).pathname;
        const condition =
          path === "/" ? "request.page_type == 'index'" : `request.path == '${path}'`;
        // Mobile aur desktop par theme alag size ki image load karti hai, is liye preload sirf tested device ke liye.
        const media =
          input.strategy === "desktop" ? "(min-width: 768px)" : "(max-width: 767px)";
        headTags.unshift(
          `{%- if ${condition} -%}\n  <link rel="preload" as="image" href="${image}" media="${media}" fetchpriority="high">\n{%- endif -%}`,
        );
        report.notes.push(`LCP image (${input.strategy}): ${image}`);
        report.notes.push(
          "Agar is page ki hero image badlein to speed test aur ye fix dobara chalayein.",
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
        report.notes.push(`${count} script tag(s) par defer lagaya.`);
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
            ? `${count} stylesheet(s) async ki gayin.`
            : "Koi non-critical render-blocking stylesheet theme.liquid me nahi mili.",
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
        report.notes.push(`${count} image/iframe tag(s) lazy kiye.`);
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
        report.notes.push(`${count} font declaration(s) update kiye.`);
        break;
      }
    }
  }

  // Preconnect/preload tags ek alag snippet me jate hain jo <head> ke shuru me render hota hai.
  const createdFiles: string[] = [];
  if (headTags.length) {
    const snippet = `{%- comment -%} Speed Optimizer app ne generate kiya. Rollback app se karein. {%- endcomment -%}\n${headTags.join("\n")}\n`;
    if (!originals.has(SNIPPET)) createdFiles.push(SNIPPET);
    current.set(SNIPPET, snippet);

    const layout = current.get(LAYOUT)!;
    if (!layout.includes(RENDER_TAG)) {
      // <meta charset> pehle 1024 bytes me rehna chahiye, is liye snippet uske baad.
      const anchor = /<meta\s+charset[^>]*>/i.test(layout) ? /<meta\s+charset[^>]*>/i : /<head\b[^>]*>/i;
      current.set(LAYOUT, layout.replace(anchor, (m) => `${m}\n    ${RENDER_TAG}`));
    }
  }

  const changes = [...current]
    .filter(([name, content]) => originals.get(name) !== content)
    .map(([filename, content]) => ({ filename, content }));

  return {
    changes,
    createdFiles,
    originals: changes
      .filter((c) => originals.has(c.filename))
      .map((c) => ({ filename: c.filename, content: originals.get(c.filename)! })),
    reports,
  };
}

export async function applyPlan(
  admin: AdminApiContext,
  shop: string,
  theme: { id: string; name: string },
  plan: Plan,
  speedTestId: string | null,
) {
  if (!plan.changes.length) return null;
  // Pehle backup save, phir theme me likhna — taake fail hone par bhi rollback ho sake.
  const record = await prisma.optimization.create({
    data: {
      shop,
      themeId: theme.id,
      themeName: theme.name,
      fixes: JSON.stringify(plan.reports),
      backups: JSON.stringify(plan.originals),
      createdFiles: JSON.stringify(plan.createdFiles),
      speedTestId,
    },
  });
  await writeThemeFiles(admin, theme.id, plan.changes);
  return record;
}

export async function rollback(admin: AdminApiContext, shop: string, id: string) {
  const record = await prisma.optimization.findFirst({ where: { id, shop } });
  if (!record || record.rolledBack) throw new Error("Optimization nahi mili.");
  const newer = await prisma.optimization.count({
    where: { shop, themeId: record.themeId, rolledBack: false, createdAt: { gt: record.createdAt } },
  });
  if (newer) {
    throw new Error("Pehle is theme ki naye optimizations rollback karein (latest se shuru karein).");
  }

  const backups: ThemeFile[] = JSON.parse(record.backups);
  const created: string[] = JSON.parse(record.createdFiles);
  // Snippet hatane se pehle layout restore karna zaroori hai, warna render tag toot jayega.
  await writeThemeFiles(admin, record.themeId, backups);
  await deleteThemeFiles(admin, record.themeId, created);

  await prisma.optimization.update({ where: { id }, data: { rolledBack: true } });
}
