// Mandatory GDPR webhook. The app stores no customer data, so there is nothing to report.
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop} (no customer data stored)`);
  return new Response();
};
