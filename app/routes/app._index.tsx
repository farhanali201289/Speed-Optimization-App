import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { FIXES, recommendedFixes, scoreTone, type FixId } from "../fixes";
import {
  runPageSpeed,
  type Audit,
  type Metric,
  type Strategy,
} from "../services/pagespeed.server";
import { getStoreInfo } from "../services/theme.server";
import {
  applyPlan,
  findLcpImage,
  planFixes,
  type FixReport,
} from "../services/optimizer.server";

function parseTest(test: Awaited<ReturnType<typeof prisma.speedTest.findFirst>>) {
  if (!test) return null;
  return {
    id: test.id,
    url: test.url,
    strategy: test.strategy as Strategy,
    score: test.score,
    createdAt: test.createdAt.toISOString(),
    metrics: JSON.parse(test.metrics) as Metric[],
    audits: JSON.parse(test.audits) as Audit[],
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const store = await getStoreInfo(admin);

  const [latest, previous] = (
    await prisma.speedTest.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
      take: 2,
    })
  ).map(parseTest);

  let recommended: FixId[] = [];
  if (latest) {
    const failing = latest.audits
      .filter((a) => a.score !== null && a.score < 0.9)
      .map((a) => a.id);
    recommended = recommendedFixes(failing);
    const lcp = latest.metrics.find((m) => m.id === "largest-contentful-paint");
    if ((lcp?.score ?? 1) < 0.9 && findLcpImage(latest.audits)) {
      recommended.push("preload-lcp");
    }
  }

  return {
    store,
    latest,
    previous:
      previous && latest && previous.strategy === latest.strategy ? previous : null,
    recommended: [...new Set(recommended)],
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const body = await request.json();

  try {
    if (body.intent === "test") {
      const result = await runPageSpeed(body.url, body.strategy);
      await prisma.speedTest.create({
        data: {
          shop: session.shop,
          url: result.url,
          strategy: result.strategy,
          score: result.score,
          metrics: JSON.stringify(result.metrics),
          audits: JSON.stringify(result.audits),
        },
      });
      return { intent: "test" as const, ok: true, score: result.score };
    }

    if (body.intent === "preview" || body.intent === "apply") {
      const store = await getStoreInfo(admin);
      const theme = store.themes.find((t) => t.id === body.themeId);
      const test = parseTest(
        await prisma.speedTest.findFirst({
          where: { id: body.testId, shop: session.shop },
        }),
      );
      if (!theme || !test) throw new Error("Theme ya speed test nahi mila.");

      const plan = await planFixes(admin, theme.id, {
        fixes: body.fixes,
        audits: test.audits,
        testedUrl: test.url,
        storeUrl: store.storeUrl,
      });

      if (body.intent === "apply") {
        await applyPlan(admin, session.shop, theme, plan, test.id);
      }
      return {
        intent: body.intent as "preview" | "apply",
        ok: true,
        reports: plan.reports,
        changedFiles: plan.changes.map((c) => c.filename),
      };
    }

    throw new Error("Unknown action");
  } catch (error) {
    return {
      intent: body.intent,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

type ActionData = {
  intent: string;
  ok: boolean;
  error?: string;
  score?: number;
  reports?: FixReport[];
  changedFiles?: string[];
};

const METRIC_SHORT: Record<string, string> = {
  "first-contentful-paint": "FCP",
  "largest-contentful-paint": "LCP",
  "total-blocking-time": "TBT",
  "cumulative-layout-shift": "CLS",
  "speed-index": "Speed Index",
};

export default function Dashboard() {
  const { store, latest, previous, recommended } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();

  const testFetcher = useFetcher<ActionData>();
  const fixFetcher = useFetcher<ActionData>();

  const liveTheme = store.themes.find((t) => t.role === "MAIN");
  const [url, setUrl] = useState(latest?.url ?? store.storeUrl);
  const [strategy, setStrategy] = useState<Strategy>(latest?.strategy ?? "mobile");
  const [themeId, setThemeId] = useState(liveTheme?.id ?? store.themes[0]?.id ?? "");
  const [selected, setSelected] = useState<FixId[]>(recommended);

  useEffect(() => setSelected(recommended), [latest?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const testing = testFetcher.state !== "idle";
  const fixing = fixFetcher.state !== "idle";

  useEffect(() => {
    const data = testFetcher.data;
    if (testFetcher.state !== "idle" || !data) return;
    if (data.ok) shopify.toast.show(`Speed test mukammal: score ${data.score}`);
    else shopify.toast.show(data.error ?? "Test fail ho gaya", { isError: true });
  }, [testFetcher.state, testFetcher.data, shopify]);

  useEffect(() => {
    const data = fixFetcher.data;
    if (fixFetcher.state !== "idle" || !data) return;
    if (!data.ok) shopify.toast.show(data.error ?? "Fix fail ho gaya", { isError: true });
    else if (data.intent === "apply") {
      shopify.toast.show("Fixes theme par apply ho gaye");
      revalidator.revalidate();
    }
  }, [fixFetcher.state, fixFetcher.data, shopify, revalidator]);

  const submitJson = (fetcher: typeof testFetcher, payload: object) =>
    fetcher.submit(payload as Record<string, any>, {
      method: "POST",
      encType: "application/json",
    });

  const runTest = () => submitJson(testFetcher, { intent: "test", url, strategy });
  const runFixes = (intent: "preview" | "apply") =>
    submitJson(fixFetcher, {
      intent,
      themeId,
      testId: latest?.id,
      fixes: selected,
    });

  const toggleFix = (id: FixId, checked: boolean) =>
    setSelected((prev) => (checked ? [...prev, id] : prev.filter((f) => f !== id)));

  const previewData = fixFetcher.data?.ok ? fixFetcher.data : null;
  const selectedTheme = store.themes.find((t) => t.id === themeId);

  return (
    <s-page heading="Speed Optimizer">
      <s-section heading="1. PageSpeed Insights test">
        <s-stack direction="block" gap="base">
          <s-url-field
            label="Page URL"
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
            details="Store ka koi bhi page test karein. Password-protected store par PSI password page test karega."
          />
          <s-select
            label="Device"
            value={strategy}
            onChange={(e) => setStrategy(e.currentTarget.value as Strategy)}
          >
            <s-option value="mobile">Mobile</s-option>
            <s-option value="desktop">Desktop</s-option>
          </s-select>
          <s-stack direction="inline" gap="base">
            <s-button variant="primary" onClick={runTest} {...(testing ? { loading: true } : {})}>
              Speed test chalayein
            </s-button>
          </s-stack>
          {testing && (
            <s-paragraph>
              Google Lighthouse test chal raha hai, is me 30–60 seconds lag sakte hain…
            </s-paragraph>
          )}
        </s-stack>
      </s-section>

      {latest && (
        <s-section heading="2. Result">
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-heading>Performance score: {latest.score}</s-heading>
              <s-badge tone={scoreTone(latest.score)}>
                {latest.strategy === "mobile" ? "Mobile" : "Desktop"}
              </s-badge>
              {previous && (
                <s-badge tone={latest.score >= previous.score ? "success" : "critical"}>
                  {`Pichla: ${previous.score} (${latest.score >= previous.score ? "+" : ""}${latest.score - previous.score})`}
                </s-badge>
              )}
            </s-stack>
            <s-text color="subdued">
              {latest.url} · {new Date(latest.createdAt).toLocaleString()}
            </s-text>

            <s-table>
              <s-table-header-row>
                <s-table-header>Metric</s-table-header>
                <s-table-header>Value</s-table-header>
                <s-table-header>Pichla</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {latest.metrics.map((m) => {
                  const prev = previous?.metrics.find((p) => p.id === m.id);
                  return (
                    <s-table-row key={m.id}>
                      <s-table-cell>{METRIC_SHORT[m.id] ?? m.title}</s-table-cell>
                      <s-table-cell>
                        <s-badge tone={scoreTone((m.score ?? 0) * 100)}>{m.displayValue}</s-badge>
                      </s-table-cell>
                      <s-table-cell>{prev?.displayValue ?? "—"}</s-table-cell>
                    </s-table-row>
                  );
                })}
              </s-table-body>
            </s-table>

            <s-heading>Masle (opportunities & diagnostics)</s-heading>
            <s-unordered-list>
              {latest.audits
                .filter((a) => a.score !== null && a.score < 0.9)
                .slice(0, 12)
                .map((a) => (
                  <s-list-item key={a.id}>
                    {a.title}
                    {a.displayValue ? ` — ${a.displayValue}` : ""}
                  </s-list-item>
                ))}
            </s-unordered-list>
          </s-stack>
        </s-section>
      )}

      {latest && (
        <s-section heading="3. Theme fixes">
          <s-stack direction="block" gap="base">
            <s-select
              label="Theme"
              value={themeId}
              onChange={(e) => setThemeId(e.currentTarget.value)}
              details="Pehle unpublished copy par try karna mehfooz hai. Har change ka backup bana kar rakha jata hai."
            >
              {store.themes.map((t) => (
                <s-option key={t.id} value={t.id}>
                  {t.role === "MAIN" ? `${t.name} (LIVE)` : t.name}
                </s-option>
              ))}
            </s-select>

            {FIXES.map((fix) => (
              <s-box key={fix.id} padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small-200">
                  <s-checkbox
                    label={fix.title}
                    checked={selected.includes(fix.id)}
                    onChange={(e) => toggleFix(fix.id, e.currentTarget.checked)}
                  />
                  <s-text color="subdued">{fix.description}</s-text>
                  <s-stack direction="inline" gap="small-200">
                    {fix.metrics.map((m) => (
                      <s-badge key={m}>{m}</s-badge>
                    ))}
                    {recommended.includes(fix.id) && <s-badge tone="info">Recommended</s-badge>}
                    {fix.risk === "medium" && <s-badge tone="warning">Medium risk</s-badge>}
                  </s-stack>
                </s-stack>
              </s-box>
            ))}

            <s-stack direction="inline" gap="base">
              <s-button
                onClick={() => runFixes("preview")}
                disabled={!selected.length || fixing}
                {...(fixing && fixFetcher.json && (fixFetcher.json as any).intent === "preview" ? { loading: true } : {})}
              >
                Preview changes
              </s-button>
              <s-button
                variant="primary"
                tone={selectedTheme?.role === "MAIN" ? "critical" : "auto"}
                onClick={() => runFixes("apply")}
                disabled={!selected.length || fixing || previewData?.intent !== "preview"}
                {...(fixing && fixFetcher.json && (fixFetcher.json as any).intent === "apply" ? { loading: true } : {})}
              >
                {selectedTheme?.role === "MAIN" ? "Live theme par apply karein" : "Theme par apply karein"}
              </s-button>
            </s-stack>

            {previewData?.reports && (
              <s-banner
                tone={previewData.intent === "apply" ? "success" : "info"}
                heading={
                  previewData.intent === "apply"
                    ? `${previewData.changedFiles?.length ?? 0} file(s) update ho gayin`
                    : `Preview: ${previewData.changedFiles?.length ?? 0} file(s) badlengi`
                }
              >
                <s-stack direction="block" gap="small-200">
                  {previewData.reports.map((r) => (
                    <s-paragraph key={r.id}>
                      <s-text type="strong">{r.title}: </s-text>
                      {r.notes.join(" ")}
                      {r.files.length ? ` (${r.files.join(", ")})` : ""}
                    </s-paragraph>
                  ))}
                  {previewData.intent === "apply" && (
                    <s-paragraph>
                      Shopify cache update hone me 1–2 minute lag sakte hain, phir upar se speed test
                      dobara chalayein. Kuch kharab ho to History page se rollback karein.
                    </s-paragraph>
                  )}
                </s-stack>
              </s-banner>
            )}
          </s-stack>
        </s-section>
      )}

      <s-section slot="aside" heading="Store">
        <s-paragraph>{store.shopName}</s-paragraph>
        <s-paragraph>
          <s-link href={store.storeUrl} target="_blank">{store.storeUrl}</s-link>
        </s-paragraph>
        <s-paragraph>Live theme: {liveTheme?.name ?? "—"}</s-paragraph>
      </s-section>

      <s-section slot="aside" heading="Kaise kaam karta hai">
        <s-ordered-list>
          <s-list-item>PageSpeed Insights se test chalayein.</s-list-item>
          <s-list-item>Result ke hisab se recommended fixes khud select ho jate hain.</s-list-item>
          <s-list-item>Preview dekh kar theme par apply karein (backup ke sath).</s-list-item>
          <s-list-item>Dobara test karke score compare karein.</s-list-item>
        </s-ordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
