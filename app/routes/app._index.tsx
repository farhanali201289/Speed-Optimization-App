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
import { FIXES, oneClickFixes, scoreTone, type FixId } from "../fixes";
import type { Metric, Strategy } from "../services/pagespeed.server";
import { getStoreInfo } from "../services/theme.server";
import {
  handleIntent,
  lastOptimization,
  parseTest,
  recommendedFor,
  type IntentResult,
} from "../services/speed.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [store, tests, lastRun] = await Promise.all([
    getStoreInfo(admin),
    prisma.speedTest.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
      take: 2,
    }),
    lastOptimization(session.shop),
  ]);
  const [latest, previous] = tests.map(parseTest);

  return {
    store,
    latest,
    previous:
      previous && latest && previous.strategy === latest.strategy ? previous : null,
    recommended: latest ? [...new Set(recommendedFor(latest))] : [],
    lastRun,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  return handleIntent(admin, session.shop, await request.json());
};

const METRIC_SHORT: Record<string, string> = {
  "first-contentful-paint": "FCP",
  "largest-contentful-paint": "LCP",
  "total-blocking-time": "TBT",
  "cumulative-layout-shift": "CLS",
  "speed-index": "Speed Index",
};

type Stage = "idle" | "before" | "apply" | "after" | "done" | "error";

const STAGE_TEXT: Record<Stage, string> = {
  idle: "",
  before: "1/3 — Testing current speed (30–60 sec)…",
  apply: "2/3 — Applying fixes to the live theme (with backup)…",
  after: "3/3 — Re-testing speed after fixes (30–60 sec)…",
  done: "",
  error: "",
};

// Calls /app/api. App Bridge adds the session token to this fetch automatically.
async function callApi(body: object): Promise<IntentResult> {
  const res = await fetch("/app/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  const data: IntentResult = await res.json();
  if (!data.ok) throw new Error(data.error ?? "Something went wrong");
  return data;
}

function metricValue(metrics: Metric[] | undefined, id: string) {
  return metrics?.find((m) => m.id === id)?.displayValue ?? "—";
}

export default function Dashboard() {
  const { store, latest, previous, recommended, lastRun } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const revalidator = useRevalidator();

  const testFetcher = useFetcher<IntentResult>();
  const fixFetcher = useFetcher<IntentResult>();

  const liveTheme = store.themes.find((t) => t.role === "MAIN");
  const [url, setUrl] = useState(latest?.url ?? store.storeUrl);
  const [strategy, setStrategy] = useState<Strategy>(latest?.strategy ?? "mobile");
  const [themeId, setThemeId] = useState(liveTheme?.id ?? store.themes[0]?.id ?? "");
  const [selected, setSelected] = useState<FixId[]>(recommended);

  const [stage, setStage] = useState<Stage>("idle");
  const [stageError, setStageError] = useState("");
  const [noChanges, setNoChanges] = useState(false);

  useEffect(() => setSelected(recommended), [latest?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const testing = testFetcher.state !== "idle";
  const fixing = fixFetcher.state !== "idle";
  const boosting = ["before", "apply", "after"].includes(stage);

  useEffect(() => {
    const data = testFetcher.data;
    if (testFetcher.state !== "idle" || !data) return;
    if (data.ok) shopify.toast.show(`Speed test complete: score ${data.score}`);
    else shopify.toast.show(data.error ?? "Speed test failed", { isError: true });
  }, [testFetcher.state, testFetcher.data, shopify]);

  useEffect(() => {
    const data = fixFetcher.data;
    if (fixFetcher.state !== "idle" || !data) return;
    if (!data.ok) shopify.toast.show(data.error ?? "Applying fixes failed", { isError: true });
    else if (data.intent === "apply") {
      shopify.toast.show("Fixes applied to the theme");
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
    submitJson(fixFetcher, { intent, themeId, testId: latest?.id, fixes: selected });

  const toggleFix = (id: FixId, checked: boolean) =>
    setSelected((prev) => (checked ? [...prev, id] : prev.filter((f) => f !== id)));

  // One click: test -> low-risk fixes on the live theme -> re-test.
  const boost = async () => {
    setStageError("");
    setNoChanges(false);
    try {
      setStage("before");
      const before = await callApi({ intent: "test", url, strategy });

      setStage("apply");
      const optimized = await callApi({ intent: "optimize", testId: before.testId });
      if (!optimized.changedFiles?.length) {
        setNoChanges(true);
        setStage("done");
        revalidator.revalidate();
        shopify.toast.show("Live theme is already optimized");
        return;
      }

      setStage("after");
      // Give Shopify a moment to publish the theme change.
      await new Promise((r) => setTimeout(r, 5000));
      const after = await callApi({ intent: "test", url, strategy });

      setStage("done");
      revalidator.revalidate();
      shopify.toast.show(`Score: ${before.score} → ${after.score}`);
    } catch (error) {
      setStage("error");
      setStageError(error instanceof Error ? error.message : String(error));
      revalidator.revalidate();
    }
  };

  const previewData = fixFetcher.data?.ok ? fixFetcher.data : null;
  const selectedTheme = store.themes.find((t) => t.id === themeId);
  const autoFixes = FIXES.filter((f) => oneClickFixes(recommended).includes(f.id));

  return (
    <s-page heading="Speed Optimizer">
      <s-section heading="⚡ One-click speed boost">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            In one click: your store's speed is tested, safe (low-risk) fixes are applied to the live
            theme ({liveTheme?.name ?? "—"}), and it's re-tested to show the before/after score.
            Every change is backed up and can be rolled back from the History page.
          </s-paragraph>
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button
              variant="primary"
              onClick={boost}
              disabled={boosting || testing || fixing || !liveTheme}
              {...(boosting ? { loading: true } : {})}
            >
              Speed up my store
            </s-button>
            <s-text color="subdued">
              {url} · {strategy === "mobile" ? "Mobile" : "Desktop"}
            </s-text>
          </s-stack>

          {boosting && <s-paragraph>{STAGE_TEXT[stage]}</s-paragraph>}
          {stage === "error" && (
            <s-banner tone="critical" heading="One-click optimization stopped">
              <s-paragraph>{stageError}</s-paragraph>
            </s-banner>
          )}
          {stage === "done" && noChanges && (
            <s-banner tone="info" heading="Live theme is already optimized">
              <s-paragraph>
                All safe fixes are already applied. For more speed, try the medium-risk fix
                (defer JavaScript) on an unpublished theme copy in the "Theme fixes" section below.
              </s-paragraph>
            </s-banner>
          )}

          {lastRun && (
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-stack direction="block" gap="small-200">
                <s-stack direction="inline" gap="base" alignItems="center">
                  <s-heading>Last optimization</s-heading>
                  <s-text color="subdued">
                    {lastRun.themeName} · {new Date(lastRun.createdAt).toLocaleString()}
                  </s-text>
                </s-stack>
                <s-stack direction="inline" gap="base" alignItems="center">
                  <s-text>Score:</s-text>
                  <s-badge tone={scoreTone(lastRun.before.score)} size="large">
                    {`Before ${lastRun.before.score}`}
                  </s-badge>
                  <s-text>→</s-text>
                  {lastRun.after ? (
                    <s-badge tone={scoreTone(lastRun.after.score)} size="large">
                      {`After ${lastRun.after.score}`}
                    </s-badge>
                  ) : (
                    <s-text color="subdued">after-test not run yet</s-text>
                  )}
                </s-stack>
                <s-table>
                  <s-table-header-row>
                    <s-table-header>Metric</s-table-header>
                    <s-table-header>Before</s-table-header>
                    <s-table-header>After</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {Object.entries(METRIC_SHORT).map(([id, label]) => (
                      <s-table-row key={id}>
                        <s-table-cell>{label}</s-table-cell>
                        <s-table-cell>{metricValue(lastRun.before.metrics, id)}</s-table-cell>
                        <s-table-cell>{metricValue(lastRun.after?.metrics, id)}</s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
                <s-text color="subdued">Fixes applied: {lastRun.fixes.join(", ") || "—"}</s-text>
                <s-text color="subdued">
                  PageSpeed scores vary a little between runs (±5), so compare LCP/FCP too.
                </s-text>
              </s-stack>
            </s-box>
          )}

          {latest && autoFixes.length > 0 && !lastRun?.after && (
            <s-text color="subdued">
              Fixes the next one-click run will apply: {autoFixes.map((f) => f.title).join(", ")}
            </s-text>
          )}
        </s-stack>
      </s-section>

      <s-section heading="1. PageSpeed Insights test">
        <s-stack direction="block" gap="base">
          <s-url-field
            label="Page URL"
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
            details="Test any page of your store. On a password-protected store, PSI tests the password page."
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
            <s-button
              onClick={runTest}
              disabled={boosting}
              {...(testing ? { loading: true } : {})}
            >
              Run speed test only
            </s-button>
          </s-stack>
          {testing && (
            <s-paragraph>
              Running Google Lighthouse test, this can take 30–60 seconds…
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
                  {`Previous: ${previous.score} (${latest.score >= previous.score ? "+" : ""}${latest.score - previous.score})`}
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
                <s-table-header>Previous</s-table-header>
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

            <s-heading>Issues (opportunities & diagnostics)</s-heading>
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
        <s-section heading="3. Theme fixes (advanced)">
          <s-stack direction="block" gap="base">
            <s-select
              label="Theme"
              value={themeId}
              onChange={(e) => setThemeId(e.currentTarget.value)}
              details="Trying an unpublished copy first is safest. Every change is backed up."
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
                disabled={!selected.length || fixing || boosting}
                {...(fixing && (fixFetcher.json as any)?.intent === "preview" ? { loading: true } : {})}
              >
                Preview changes
              </s-button>
              <s-button
                variant="primary"
                tone={selectedTheme?.role === "MAIN" ? "critical" : "auto"}
                onClick={() => runFixes("apply")}
                disabled={!selected.length || fixing || boosting || previewData?.intent !== "preview"}
                {...(fixing && (fixFetcher.json as any)?.intent === "apply" ? { loading: true } : {})}
              >
                {selectedTheme?.role === "MAIN" ? "Apply to live theme" : "Apply to theme"}
              </s-button>
            </s-stack>

            {previewData?.reports && (
              <s-banner
                tone={previewData.intent === "apply" ? "success" : "info"}
                heading={
                  previewData.intent === "apply"
                    ? `${previewData.changedFiles?.length ?? 0} file(s) updated`
                    : `Preview: ${previewData.changedFiles?.length ?? 0} file(s) will change`
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
                      Shopify's cache can take 1–2 minutes to update; then run the speed test again
                      above. If anything looks wrong, roll back from the History page.
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

      <s-section slot="aside" heading="How it works">
        <s-ordered-list>
          <s-list-item>Click "Speed up my store" — the app does the rest.</s-list-item>
          <s-list-item>Only safe fixes are applied to the live theme, with a backup.</s-list-item>
          <s-list-item>Before/after score and LCP/FCP are shown above.</s-list-item>
          <s-list-item>If anything looks wrong, roll back from the History page.</s-list-item>
        </s-ordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
