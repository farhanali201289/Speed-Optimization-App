// Google PageSpeed Insights (Lighthouse) API wrapper.
// Docs: https://developers.google.com/speed/docs/insights/v5/reference/pagespeedapi/runpagespeed

export type Strategy = "mobile" | "desktop";

export interface Metric {
  id: string;
  title: string;
  displayValue: string;
  numericValue: number;
  score: number | null;
}

export interface AuditItem {
  url?: string;
  wastedMs?: number;
  wastedBytes?: number;
  totalBytes?: number;
  snippet?: string;
}

export interface Audit {
  id: string;
  title: string;
  description: string;
  displayValue?: string;
  score: number | null;
  savingsMs?: number;
  items: AuditItem[];
}

export interface SpeedResult {
  url: string;
  strategy: Strategy;
  score: number;
  metrics: Metric[];
  audits: Audit[];
}

const METRIC_IDS = [
  "first-contentful-paint",
  "largest-contentful-paint",
  "total-blocking-time",
  "cumulative-layout-shift",
  "speed-index",
];

// Ye audits hamesha save hote hain (score chahe kuch bhi ho) kyunke fixes inke data par depend karte hain.
const ALWAYS_KEEP = new Set([
  "largest-contentful-paint-element",
  "lcp-discovery-insight",
  "prioritize-lcp-image",
]);

const PSI_ENDPOINT =
  "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

export async function runPageSpeed(
  url: string,
  strategy: Strategy,
): Promise<SpeedResult> {
  const params = new URLSearchParams({ url, strategy, category: "performance" });
  if (process.env.PAGESPEED_API_KEY) {
    params.set("key", process.env.PAGESPEED_API_KEY);
  }

  const res = await fetch(`${PSI_ENDPOINT}?${params}`, {
    signal: AbortSignal.timeout(120_000),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message ?? `PageSpeed API error ${res.status}`);
  }

  const lh = json.lighthouseResult;
  const rawAudits: Record<string, any> = lh.audits;

  const metrics: Metric[] = METRIC_IDS.filter((id) => rawAudits[id]).map(
    (id) => ({
      id,
      title: rawAudits[id].title,
      displayValue: rawAudits[id].displayValue ?? "",
      numericValue: rawAudits[id].numericValue ?? 0,
      score: rawAudits[id].score,
    }),
  );

  const audits: Audit[] = Object.values(rawAudits)
    .filter((a: any) => {
      if (METRIC_IDS.includes(a.id)) return false;
      if (ALWAYS_KEEP.has(a.id)) return true;
      if (["notApplicable", "manual", "error"].includes(a.scoreDisplayMode)) {
        return false;
      }
      return a.score !== null && a.score < 0.9;
    })
    .map((a: any) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      displayValue: a.displayValue,
      score: a.score,
      savingsMs:
        a.details?.overallSavingsMs ?? a.metricSavings?.LCP ?? undefined,
      items: extractItems(a.details).map((item) =>
        ALWAYS_KEEP.has(a.id) ? withFullImageUrl(item, rawAudits) : item,
      ),
    }))
    .sort((a, b) => (b.savingsMs ?? 0) - (a.savingsMs ?? 0));

  return {
    url: lh.finalDisplayedUrl ?? url,
    strategy,
    score: Math.round((lh.categories.performance.score ?? 0) * 100),
    metrics,
    audits,
  };
}

// Lighthouse node snippet me lambe attributes "…" se kat jate hain, jaise src="//x.com/a.jpg?v=123…".
// Poora URL network-requests audit se dhoondh kar item.url me rakhte hain, taake preload asli URL ka ho.
function withFullImageUrl(item: AuditItem, rawAudits: Record<string, any>): AuditItem {
  const src =
    item.snippet?.match(/\bsrc="([^"]+)"/)?.[1] ??
    item.snippet?.match(/\bsrcset="([^"\s,]+)/)?.[1];
  if (!src) return item;

  const strip = (u: string) =>
    u.replace(/&amp;/g, "&").replace(/^https?:/, "").replace(/^\/\//, "");
  const prefix = strip(src.split("…")[0]);
  const requests: any[] = rawAudits["network-requests"]?.details?.items ?? [];
  const match = requests.find(
    (r) =>
      typeof r.url === "string" &&
      (r.resourceType === "Image" || /\.(jpe?g|png|webp|avif|gif)/i.test(r.url)) &&
      strip(r.url).startsWith(prefix),
  );
  if (match) return { ...item, url: match.url };
  // Agar URL kata hua nahi tha to wahi istemal kar sakte hain.
  return src.includes("…") ? item : { ...item, url: src.startsWith("//") ? `https:${src}` : src };
}

// Lighthouse details nested ho sakti hain (list -> table), sab items flat kar dete hain.
function extractItems(details: any, out: AuditItem[] = []): AuditItem[] {
  if (!details || typeof details !== "object" || out.length >= 15) return out;
  if (details.type === "node" && details.snippet) {
    out.push({ snippet: details.snippet });
    return out;
  }
  // "checklist" me items object hota hai (array nahi), us me URLs nahi hote.
  if (!Array.isArray(details.items)) return out;
  if (details.type === "list") {
    for (const d of details.items) extractItems(d, out);
    return out;
  }
  for (const item of details.items) {
    if (out.length >= 15) break;
    const url = typeof item.url === "string" ? item.url : item.source?.url;
    const snippet = item.node?.snippet ?? item.snippet;
    if (!url && !snippet) continue;
    out.push({
      url,
      wastedMs: item.wastedMs,
      wastedBytes: item.wastedBytes,
      totalBytes: item.totalBytes,
      snippet,
    });
  }
  return out;
}
