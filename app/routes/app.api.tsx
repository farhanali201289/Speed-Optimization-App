// JSON endpoint the dashboard's one-click flow calls with `fetch`.
// App Bridge adds the session token to the fetch automatically.
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { handleIntent } from "../services/speed.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  return Response.json(await handleIntent(admin, session.shop, await request.json()));
};
