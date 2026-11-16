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
// Main/base stylesheet critical hoti hai, use async karne se layout flash hota hai.
const CRITICAL_CSS = /^(base|theme|main|styles?|critical|global|app)[.-]/i;

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
}

export function findLcpImage(audits: Audit[]): string | null {
  const lcpIds = [
    "largest-contentful-paint-element",
    "lcp-discovery-insight",
    "prioritize-lcp-image",
  ];
  for (const audit of audits.filter((a) => lcpIds.includes(a.id))) {
    for (const item of audit.items) {
      const fromSnippet =
        item.snippet?.match(/\bsrc="([^"]+)"/)?.[1] ??
        item.snippet?.match(/\bsrcset="([^"\s,]+)/)?.[1];
      const url = fromSnippet ?? item.url;
      if (url && /\.(jpe?g|png|webp|avif|gif)(\?|$)|\/cdn\/shop\//i.test(url)) {
        return url.startsWith("//") ? `https:${url}` : url.replace(/&amp;/g, "&");
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
        const storeOrigin = new URL(input.storeUrl).origin;
        const origins = new Set<string>(["https://cdn.shopify.com"]);
        if (/font_face|font_url/.test(current.get(LAYOUT)!)) {
          origins.add("https://fonts.shopifycdn.com");
        }
        for (const url of auditUrls(input.audits, fix.auditIds)) {
          const origin = new URL(url).origin;
          if (origin !== storeOrigin) origins.add(origin);
        }
        // 4 se zyada preconnect ulta nuqsan karte hain.
        for (const origin of [...origins].slice(0, 4)) {
          headTags.push(`<link rel="preconnect" href="${origin}" crossorigin>`);
          report.notes.push(`preconnect: ${origin}`);
        }
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
        headTags.push(
          `{%- if ${condition} -%}\n  <link rel="preload" as="image" href="${image}" fetchpriority="high">\n{%- endif -%}`,
        );
        report.notes.push(`LCP image: ${image}`);
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
        let count = 0;
        let layout = current.get(LAYOUT)!;
        layout = layout.replace(
          /\{\{-?\s*['"]([^'"]+\.css)['"]\s*\|\s*asset_url\s*\|\s*stylesheet_tag\s*-?\}\}/g,
          (tag, name: string) => {
            if (CRITICAL_CSS.test(name) || !blockingNames.has(name)) return tag;
            count++;
            return `<link rel="preload" href="{{ '${name}' | asset_url }}" as="style" onload="this.onload=null;this.rel='stylesheet'"><noscript>{{ '${name}' | asset_url | stylesheet_tag }}</noscript>`;
          },
        );
        // Third-party stylesheets jo PSI ne flag ki hon.
        layout = layout.replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi, (tag) => {
          const href = tag.match(/href=["']([^"']+)["']/)?.[1];
          if (!href || /\bmedia=|onload=/.test(tag)) return tag;
          if (!blocking.some((u) => u.includes(href.replace(/^https?:/, "")))) return tag;
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
      current.set(LAYOUT, layout.replace(/<head\b[^>]*>/i, (m) => `${m}\n    ${RENDER_TAG}`));
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
