// Handles actions for both the dashboard and /app/api.
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { oneClickFixes, recommendedFixes, type FixId } from "../fixes";
import { runPageSpeed, type Audit, type Metric, type Strategy } from "./pagespeed.server";
import { getStoreInfo } from "./theme.server";
import { applyPlan, findLcpImage, planFixes, type FixReport } from "./optimizer.server";

export interface SpeedTestData {
  id: string;
  url: string;
  strategy: Strategy;
  score: number;
  createdAt: string;
  metrics: Metric[];
  audits: Audit[];
}

export type IntentResult = {
  intent: string;
  ok: boolean;
  error?: string;
  testId?: string;
  score?: number;
  reports?: FixReport[];
  changedFiles?: string[];
  fixes?: FixId[];
};

export function parseTest(
  test: Awaited<ReturnType<typeof prisma.speedTest.findFirst>>,
): SpeedTestData | null {
  if (!test) return null;
  return {
    id: test.id,
    url: test.url,
    strategy: test.strategy as Strategy,
    score: test.score,
    createdAt: test.createdAt.toISOString(),
    metrics: JSON.parse(test.metrics),
    audits: JSON.parse(test.audits),
  };
}

export function recommendedFor(test: SpeedTestData): FixId[] {
  const failing = test.audits
    .filter((a) => a.score !== null && a.score < 0.9)
    .map((a) => a.id);
  // preload-lcp only when LCP is poor and an image was found; a failing audit alone isn't enough.
  const ids: FixId[] = recommendedFixes(failing).filter((id) => id !== "preload-lcp");
  const lcp = test.metrics.find((m) => m.id === "largest-contentful-paint");
  if ((lcp?.score ?? 1) < 0.9 && findLcpImage(test.audits)) ids.push("preload-lcp");
  return ids;
}

export async function handleIntent(
  admin: AdminApiContext,
  shop: string,
  body: any,
): Promise<IntentResult> {
  try {
    if (body.intent === "test") {
      const result = await runPageSpeed(body.url, body.strategy);
      const saved = await prisma.speedTest.create({
        data: {
          shop,
          url: result.url,
          strategy: result.strategy,
          score: result.score,
          metrics: JSON.stringify(result.metrics),
          audits: JSON.stringify(result.audits),
        },
      });
      return { intent: "test", ok: true, testId: saved.id, score: result.score };
    }

    if (["preview", "apply", "optimize"].includes(body.intent)) {
      const store = await getStoreInfo(admin);
      const test = parseTest(
        await prisma.speedTest.findFirst({ where: { id: body.testId, shop } }),
      );
      // One-click always runs on the live (MAIN) theme.
      const theme =
        body.intent === "optimize"
          ? store.themes.find((t) => t.role === "MAIN")
          : store.themes.find((t) => t.id === body.themeId);
      if (!theme || !test) throw new Error("Theme or speed test not found.");

      const fixes: FixId[] =
        body.intent === "optimize" ? oneClickFixes(recommendedFor(test)) : body.fixes;
      if (!fixes.length) {
        return { intent: body.intent, ok: true, reports: [], changedFiles: [], fixes };
      }

      const plan = await planFixes(admin, theme.id, {
        fixes,
        audits: test.audits,
        testedUrl: test.url,
        storeUrl: store.storeUrl,
        strategy: test.strategy,
      });
      if (body.intent !== "preview") {
        await applyPlan(admin, shop, theme, plan, test.id);
      }
      return {
        intent: body.intent,
        ok: true,
        reports: plan.reports,
        changedFiles: plan.changes.map((c) => c.filename),
        fixes,
      };
    }

    throw new Error("Unknown action");
  } catch (error) {
    console.error(`[speed] ${body?.intent} failed for ${shop}:`, error);
    return {
      intent: body?.intent,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Before/after scores of the most recent optimization.
export async function lastOptimization(shop: string) {
  const opt = await prisma.optimization.findFirst({
    where: { shop, rolledBack: false },
    orderBy: { createdAt: "desc" },
  });
  if (!opt?.speedTestId) return null;
  const before = await prisma.speedTest.findFirst({ where: { id: opt.speedTestId, shop } });
  if (!before) return null;
  const after = await prisma.speedTest.findFirst({
    where: { shop, url: before.url, strategy: before.strategy, createdAt: { gt: opt.createdAt } },
    orderBy: { createdAt: "desc" },
  });
  return {
    id: opt.id,
    themeName: opt.themeName,
    createdAt: opt.createdAt.toISOString(),
    fixes: (JSON.parse(opt.fixes) as FixReport[]).filter((f) => f.files.length).map((f) => f.title),
    before: parseTest(before)!,
    after: parseTest(after),
  };
}
