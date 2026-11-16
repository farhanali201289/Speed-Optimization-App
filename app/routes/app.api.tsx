// JSON endpoint jise dashboard ka one-click flow `fetch` se call karta hai.
// App Bridge fetch me session token khud laga deta hai.
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { handleIntent } from "../services/speed.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  return Response.json(await handleIntent(admin, session.shop, await request.json()));
};
