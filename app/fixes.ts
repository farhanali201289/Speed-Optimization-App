// Fixes ka catalog. Client aur server dono isay use karte hain, is liye yahan koi server code nahi.

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
  // In me se koi bhi PSI audit fail ho to ye fix recommend hota hai.
  auditIds: string[];
}

export const FIXES: FixDefinition[] = [
  {
    id: "preload-lcp",
    title: "LCP image preload karein",
    description:
      "Tested page ki LCP image ko <head> me fetchpriority=\"high\" ke sath preload karta hai taake browser use pehle download kare.",
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
    title: "Zaroori origins se preconnect",
    description:
      "Shopify CDN, fonts aur slow third-party origins ke liye <link rel=\"preconnect\"> add karta hai taake DNS/TLS pehle ho jaye.",
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
    title: "Render-blocking JavaScript defer karein",
    description:
      "layout/theme.liquid ke external <script> tags par defer lagata hai (jQuery chhor kar) taake HTML parsing na ruke.",
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
    title: "Non-critical CSS async load karein",
    description:
      "PSI ne jin stylesheets ko render-blocking bataya (main/base CSS ke ilawa) unhe preload + onload pattern se async karta hai.",
    metrics: ["FCP"],
    risk: "medium",
    auditIds: [
      "render-blocking-resources",
      "render-blocking-insight",
      "unused-css-rules",
    ],
  },
  {
    id: "lazy-media",
    title: "Offscreen images aur iframes lazy-load",
    description:
      "Sections/snippets me loading attribute ke baghair <img> aur <iframe> par loading=\"lazy\" lagata hai (hero/banner/header files chhor kar).",
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
    title: "Fonts par font-display: swap",
    description:
      "@font-face rules aur Liquid font_face filter me font-display: swap add karta hai taake text font load hone se pehle dikh jaye.",
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

export function scoreTone(score: number): "success" | "warning" | "critical" {
  if (score >= 90) return "success";
  if (score >= 50) return "warning";
  return "critical";
}
