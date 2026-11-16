// Admin GraphQL helpers: list themes, read/write/delete theme files.
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

type Admin = AdminApiContext;

export interface ThemeInfo {
  id: string;
  name: string;
  role: string;
}

export interface ThemeFile {
  filename: string;
  content: string;
}

async function gql<T = any>(
  admin: Admin,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await admin.graphql(query, { variables });
  const json: any = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((e: any) => e.message).join("; "));
  }
  return json.data as T;
}

export async function getStoreInfo(admin: Admin) {
  const data = await gql(
    admin,
    `#graphql
    query StoreInfo {
      shop { name primaryDomain { url } }
      themes(first: 20) { nodes { id name role } }
    }`,
  );
  return {
    shopName: data.shop.name as string,
    storeUrl: data.shop.primaryDomain.url as string,
    themes: data.themes.nodes as ThemeInfo[],
  };
}

// `filenames` supports wildcards, e.g. "sections/*.liquid".
export async function readThemeFiles(
  admin: Admin,
  themeId: string,
  filenames: string[],
): Promise<ThemeFile[]> {
  const files: ThemeFile[] = [];
  let after: string | null = null;

  do {
    const data: any = await gql(
      admin,
      `#graphql
      query ThemeFiles($id: ID!, $filenames: [String!], $after: String) {
        theme(id: $id) {
          files(filenames: $filenames, first: 50, after: $after) {
            nodes {
              filename
              body {
                ... on OnlineStoreThemeFileBodyText { content }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { id: themeId, filenames, after },
    );
    const conn = data.theme?.files;
    if (!conn) break;
    for (const node of conn.nodes) {
      // Binary files (images, fonts) have no text body; skip them.
      if (typeof node.body?.content === "string") {
        files.push({ filename: node.filename, content: node.body.content });
      }
    }
    after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (after);

  return files;
}

export async function writeThemeFiles(
  admin: Admin,
  themeId: string,
  files: ThemeFile[],
) {
  // Shopify allows up to 50 files per call.
  for (let i = 0; i < files.length; i += 50) {
    const batch = files.slice(i, i + 50);
    const data = await gql(
      admin,
      `#graphql
      mutation UpsertThemeFiles($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
        themeFilesUpsert(themeId: $themeId, files: $files) {
          upsertedThemeFiles { filename }
          userErrors { filename message }
        }
      }`,
      {
        themeId,
        files: batch.map((f) => ({
          filename: f.filename,
          body: { type: "TEXT", value: f.content },
        })),
      },
    );
    const errors = data.themeFilesUpsert.userErrors;
    if (errors.length) {
      throw new Error(
        errors.map((e: any) => `${e.filename}: ${e.message}`).join("; "),
      );
    }
  }
}

export async function deleteThemeFiles(
  admin: Admin,
  themeId: string,
  filenames: string[],
) {
  if (!filenames.length) return;
  const data = await gql(
    admin,
    `#graphql
    mutation DeleteThemeFiles($themeId: ID!, $files: [String!]!) {
      themeFilesDelete(themeId: $themeId, files: $files) {
        deletedThemeFiles { filename }
        userErrors { filename message }
      }
    }`,
    { themeId, files: filenames },
  );
  const errors = data.themeFilesDelete.userErrors;
  if (errors.length) {
    throw new Error(
      errors.map((e: any) => `${e.filename}: ${e.message}`).join("; "),
    );
  }
}
