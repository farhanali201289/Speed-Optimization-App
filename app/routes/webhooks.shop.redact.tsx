// Mandatory GDPR webhook, sent 48 hours after uninstall: delete everything stored for the shop.
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}, deleting shop data`);

  await db.$transaction([
    db.speedTest.deleteMany({ where: { shop } }),
    db.optimization.deleteMany({ where: { shop } }),
    db.session.deleteMany({ where: { shop } }),
  ]);

  return new Response();
};
