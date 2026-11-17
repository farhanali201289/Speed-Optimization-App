// Preconnect/preload settings for the "Speed Optimizer" app embed (theme app extension).
// They live in an app-data metafield, which the embed reads as app.metafields.speed_optimizer.head_config.
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { readThemeFiles } from "./theme.server";

const NAMESPACE = "speed_optimizer";
const KEY = "head_config";
// Pseudo filename used to keep the previous metafield value among an optimization's backups.
export const HEAD_CONFIG_FILE = "app-embed:head_config";
export const EMBED_LABEL = "App embed: Speed Optimizer";
export const EMBED_HANDLE = "speed-embed";
// More than 4 preconnects does more harm than good.
const MAX_PRECONNECTS = 4;

export interface HeadConfig {
  preconnects: { href: string; cors: boolean }[];
  preloads: { path: string; href: string; media: string }[];
}

export const EMPTY_HEAD_CONFIG: HeadConfig = { preconnects: [], preloads: [] };

async function gql(admin: AdminApiContext, query: string, variables?: Record<string, unknown>) {
  const res = await admin.graphql(query, { variables });
  const json: any = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((e: any) => e.message).join("; "));
  return json.data;
}

export async function getHeadConfig(admin: AdminApiContext) {
  const data = await gql(
    admin,
    `#graphql
    query HeadConfig($namespace: String!, $key: String!) {
      currentAppInstallation {
        id
        metafield(namespace: $namespace, key: $key) { value }
      }
    }`,
    { namespace: NAMESPACE, key: KEY },
  );
  const raw: string | null = data.currentAppInstallation.metafield?.value ?? null;
  let config = EMPTY_HEAD_CONFIG;
  try {
    if (raw) config = { ...EMPTY_HEAD_CONFIG, ...JSON.parse(raw) };
  } catch {}
  return { ownerId: data.currentAppInstallation.id as string, raw, config };
}

export async function setHeadConfig(admin: AdminApiContext, ownerId: string, value: string) {
  const data = await gql(
    admin,
    `#graphql
    mutation SetHeadConfig($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }`,
    { metafields: [{ ownerId, namespace: NAMESPACE, key: KEY, type: "json", value }] },
  );
  const errors = data.metafieldsSet.userErrors;
  if (errors.length) throw new Error(errors.map((e: any) => e.message).join("; "));
}

// New entries win: a preload for the same page and screen size is replaced, and the
// newest preconnect origins are kept first.
export function mergeHeadConfig(base: HeadConfig, add: HeadConfig): HeadConfig {
  const preloads = [
    ...base.preloads.filter(
      (p) => !add.preloads.some((a) => a.path === p.path && a.media === p.media),
    ),
    ...add.preloads,
  ];
  const preconnects = new Map<string, boolean>();
  for (const p of [...add.preconnects, ...base.preconnects]) {
    preconnects.set(p.href, (preconnects.get(p.href) ?? false) || p.cors);
  }
  return {
    preconnects: [...preconnects]
      .slice(0, MAX_PRECONNECTS)
      .map(([href, cors]) => ({ href, cors })),
    preloads,
  };
}

// Whether the Speed Optimizer app embed is turned on in the theme editor.
export async function isEmbedEnabled(admin: AdminApiContext, themeId: string) {
  const [file] = await readThemeFiles(admin, themeId, ["config/settings_data.json"]);
  if (!file) return false;
  try {
    const data = JSON.parse(file.content.replace(/^\s*\/\*[\s\S]*?\*\//, ""));
    const current =
      typeof data.current === "string" ? data.presets?.[data.current] : data.current;
    const blocks: Record<string, { type?: string; disabled?: boolean }> = current?.blocks ?? {};
    return Object.values(blocks).some(
      (b) => b.type?.includes(`/blocks/${EMBED_HANDLE}/`) && !b.disabled,
    );
  } catch {
    return false;
  }
}

// Deep link that opens the theme editor with the app embed toggled on, ready to save.
export function embedActivationUrl(shop: string) {
  const store = shop.replace(/\.myshopify\.com$/, "");
  const apiKey = process.env.SHOPIFY_API_KEY ?? "";
  return `https://admin.shopify.com/store/${store}/themes/current/editor?context=apps&activateAppId=${apiKey}/${EMBED_HANDLE}`;
}
