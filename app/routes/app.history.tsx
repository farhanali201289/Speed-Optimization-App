import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { scoreTone } from "../fixes";
import { rollback, type FixReport } from "../services/optimizer.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [tests, optimizations] = await Promise.all([
    prisma.speedTest.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, url: true, strategy: true, score: true, createdAt: true },
    }),
    prisma.optimization.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  return {
    tests: tests.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })),
    optimizations: optimizations.map((o) => ({
      id: o.id,
      themeName: o.themeName,
      rolledBack: o.rolledBack,
      createdAt: o.createdAt.toISOString(),
      fixes: (JSON.parse(o.fixes) as FixReport[]).filter((f) => f.files.length),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  try {
    await rollback(admin, session.shop, String(form.get("id")));
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
  }
};

export default function History() {
  const { tests, optimizations } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.ok) shopify.toast.show("Rollback ho gaya");
    else shopify.toast.show(fetcher.data.error, { isError: true });
  }, [fetcher.state, fetcher.data, shopify]);

  return (
    <s-page heading="History">
      <s-section heading="Applied optimizations">
        {optimizations.length === 0 ? (
          <s-paragraph>Abhi tak koi fix apply nahi hua.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {optimizations.map((o) => (
              <s-box key={o.id} padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small-200">
                  <s-stack direction="inline" gap="base" alignItems="center">
                    <s-heading>{o.themeName}</s-heading>
                    <s-text color="subdued">{new Date(o.createdAt).toLocaleString()}</s-text>
                    {o.rolledBack && <s-badge>Rolled back</s-badge>}
                  </s-stack>
                  <s-unordered-list>
                    {o.fixes.map((f) => (
                      <s-list-item key={f.id}>
                        {f.title} — {f.files.join(", ")}
                      </s-list-item>
                    ))}
                  </s-unordered-list>
                  {!o.rolledBack && (
                    <s-stack direction="inline">
                      <s-button
                        tone="critical"
                        onClick={() => fetcher.submit({ id: o.id }, { method: "POST" })}
                        {...(fetcher.state !== "idle" && fetcher.formData?.get("id") === o.id
                          ? { loading: true }
                          : {})}
                      >
                        Rollback
                      </s-button>
                    </s-stack>
                  )}
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>

      <s-section heading="Speed tests">
        <s-table>
          <s-table-header-row>
            <s-table-header>Date</s-table-header>
            <s-table-header>URL</s-table-header>
            <s-table-header>Device</s-table-header>
            <s-table-header>Score</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {tests.map((t) => (
              <s-table-row key={t.id}>
                <s-table-cell>{new Date(t.createdAt).toLocaleString()}</s-table-cell>
                <s-table-cell>{t.url}</s-table-cell>
                <s-table-cell>{t.strategy}</s-table-cell>
                <s-table-cell>
                  <s-badge tone={scoreTone(t.score)}>{String(t.score)}</s-badge>
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
