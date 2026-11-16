// Fix catalog, shared by client and server, so no server code here.

export type FixId =
  | "preconnect"
  | "preload-lcp"
  | "defer-js"
  | "async-css"
  | "lazy-media"
  | "font-display";

export interface FixDefinition {
  id: FixId;
  title: string;
  description: string;
  metrics: string[];
  risk: "low" | "medium";
  // The fix is recommended when any of these PSI audits fails.
  auditIds: string[];
}

export const FIXES: FixDefinition[] = [
  {
    id: "preload-lcp",
    title: "Preload the LCP image",
    description:
      "Preloads the tested page's LCP image in <head> with fetchpriority=\"high\" so the browser downloads it first.",
    metrics: ["LCP"],
    risk: "low",
    auditIds: [
      "largest-contentful-paint-element",
      "lcp-discovery-insight",
      "prioritize-lcp-image",
    ],
  },
  {
    id: "preconnect",
    title: "Preconnect to critical origins",
    description:
      "Adds <link rel=\"preconnect\"> for slow third-party origins PSI flagged, so DNS/TLS happens early.",
    metrics: ["FCP", "LCP"],
    risk: "low",
    auditIds: [
      "uses-rel-preconnect",
      "network-dependency-tree-insight",
      "render-blocking-resources",
      "render-blocking-insight",
    ],
  },
  {
    id: "defer-js",
    title: "Defer render-blocking JavaScript",
    description:
      "Adds defer to external <script> tags in layout/theme.liquid (except jQuery) so HTML parsing isn't blocked.",
    metrics: ["FCP", "TBT"],
    risk: "medium",
    auditIds: [
      "render-blocking-resources",
      "render-blocking-insight",
      "bootup-time",
      "mainthread-work-breakdown",
      "unused-javascript",
    ],
  },
  {
    id: "async-css",
    title: "Load non-critical CSS asynchronously",
    description:
      "From PSI's render-blocking list, makes only icon/animation/popup CSS (e.g. font-awesome) async. Layout CSS is left alone so the page never renders broken.",
    metrics: ["FCP"],
    risk: "low",
    auditIds: [
      "render-blocking-resources",
      "render-blocking-insight",
      "unused-css-rules",
    ],
  },
  {
    id: "lazy-media",
    title: "Lazy-load offscreen images and iframes",
    description:
      "Adds loading=\"lazy\" to <img> and <iframe> tags without a loading attribute in sections/snippets (skipping hero/banner/header files).",
    metrics: ["LCP", "Speed Index"],
    risk: "low",
    auditIds: [
      "offscreen-images",
      "uses-responsive-images",
      "image-delivery-insight",
      "total-byte-weight",
    ],
  },
  {
    id: "font-display",
    title: "Use font-display: swap for fonts",
    description:
      "Adds font-display: swap to @font-face rules and the Liquid font_face filter so text shows before fonts finish loading.",
    metrics: ["FCP"],
    risk: "low",
    auditIds: ["font-display", "font-display-insight"],
  },
];

export function recommendedFixes(failingAuditIds: string[]): FixId[] {
  const ids = new Set(failingAuditIds);
  return FIXES.filter((f) => f.auditIds.some((a) => ids.has(a))).map(
    (f) => f.id,
  );
}

// One-click optimize: only the low-risk recommended fixes.
// Medium-risk fixes (defer JS) can break store features, so they're manual only.
export function oneClickFixes(recommended: FixId[]): FixId[] {
  return FIXES.filter((f) => f.risk === "low" && recommended.includes(f.id)).map(
    (f) => f.id,
  );
}

export function scoreTone(score: number): "success" | "warning" | "critical" {
  if (score >= 90) return "success";
  if (score >= 50) return "warning";
  return "critical";
}
