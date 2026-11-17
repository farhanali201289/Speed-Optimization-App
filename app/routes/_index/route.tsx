import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { APP_NAME, SUPPORT_EMAIL } from "../../legal";
import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

// Public landing page. Merchants install from the Shopify App Store, so there is no
// shop-domain login form here.
export default function App() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>{APP_NAME}</h1>
        <p className={styles.text}>
          Test your Shopify store with Google PageSpeed Insights and apply safe theme speed fixes
          in one click — with a backup and rollback for every change.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>PageSpeed test</strong>. Mobile and desktop scores, Core Web Vitals (LCP, FCP,
            TBT, CLS) and the issues slowing your store down.
          </li>
          <li>
            <strong>One-click speed boost</strong>. Preloads the LCP image, preconnects slow
            origins, loads non-critical CSS asynchronously and fixes font loading on your live
            theme.
          </li>
          <li>
            <strong>Safe by design</strong>. Every edited theme file is backed up first and can be
            rolled back from the History page.
          </li>
        </ul>
        <p className={styles.text}>
          Install from the Shopify App Store · <a href="/privacy">Privacy policy</a> ·{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>Support</a>
        </p>
      </div>
    </div>
  );
}
