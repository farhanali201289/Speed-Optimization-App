// Public privacy policy (linked from the Shopify App Store listing). No authentication.
import type { MetaFunction } from "react-router";
import { APP_NAME, DEVELOPER_NAME, PRIVACY_UPDATED, SUPPORT_EMAIL } from "../legal";

export const meta: MetaFunction = () => [
  { title: `Privacy Policy – ${APP_NAME}` },
  { name: "description", content: `How ${APP_NAME} collects, uses and deletes data.` },
];

const styles = `
  body { margin: 0; background: #f6f6f7; color: #202223; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 48px 20px 64px; line-height: 1.6; }
  h1 { font-size: 30px; margin: 0 0 4px; }
  h2 { font-size: 19px; margin: 32px 0 8px; }
  .muted { color: #6d7175; }
  a { color: #005bd3; }
  ul { padding-left: 22px; }
`;

export default function Privacy() {
  return (
    <main>
      <style>{styles}</style>
      <h1>Privacy Policy</h1>
      <p className="muted">
        {APP_NAME} · Operated by {DEVELOPER_NAME} · Last updated {PRIVACY_UPDATED}
      </p>

      <p>
        {APP_NAME} (“the App”) helps Shopify merchants measure their store’s speed with Google
        PageSpeed Insights and apply performance fixes to their theme. This policy explains what
        data the App collects when you install it, how it is used, and how it is deleted.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Store information:</strong> your shop domain, store name, primary domain and the
          list of your themes, accessed through the Shopify Admin API.
        </li>
        <li>
          <strong>Access token:</strong> the token Shopify issues when you install the App, used
          only to call the Shopify Admin API on your behalf.
        </li>
        <li>
          <strong>Theme files:</strong> the App reads theme files (for example{" "}
          <code>layout/theme.liquid</code>, sections, snippets and CSS assets) to apply the fixes you
          choose, and stores a backup copy of every file before changing it so you can roll back.
        </li>
        <li>
          <strong>Speed test results:</strong> the URL you test, the device type and the PageSpeed
          Insights scores, metrics and audit results.
        </li>
      </ul>
      <p>
        The App does <strong>not</strong> access, collect or store any personal information about
        your customers (no names, emails, addresses, orders or payment data).
      </p>

      <h2>How we use information</h2>
      <ul>
        <li>To run speed tests on the store pages you choose.</li>
        <li>To recommend and apply theme performance fixes, and to roll them back on request.</li>
        <li>To show your test history and before/after results inside the App.</li>
      </ul>
      <p>We do not sell, rent or share your information for advertising or marketing.</p>

      <h2>Third-party services</h2>
      <ul>
        <li>
          <strong>Shopify</strong> — to authenticate you and read/write your theme through the
          Shopify Admin API.
        </li>
        <li>
          <strong>Google PageSpeed Insights API</strong> — the public URL of the store page you test
          is sent to Google to run the Lighthouse test. Google’s use of this data is covered by the{" "}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
            Google Privacy Policy
          </a>
          .
        </li>
        <li>
          <strong>Hosting</strong> — the App and its database run on a private server operated by{" "}
          {DEVELOPER_NAME}.
        </li>
      </ul>

      <h2>Data retention and deletion</h2>
      <ul>
        <li>Data is kept only while the App is installed on your store.</li>
        <li>
          When you uninstall the App, your access token is deleted immediately. Shopify then sends
          a <code>shop/redact</code> request (48 hours after uninstall), and we permanently delete
          all remaining data for your store: speed tests, theme backups and optimization history.
        </li>
        <li>
          You can request deletion at any time by emailing{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </li>
      </ul>

      <h2>Your rights</h2>
      <p>
        Depending on where you live (for example under GDPR or CCPA), you may have the right to
        access, correct or delete the data we hold about your store. Email us and we will respond
        within 30 days. Because the App stores no customer data, customer data requests received
        through Shopify are answered with no data.
      </p>

      <h2>Security</h2>
      <p>
        Data is transmitted over HTTPS and stored on a server with restricted access. Access tokens
        are used only for the Shopify API calls the App needs.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        We may update this policy from time to time. The “Last updated” date above shows the latest
        version.
      </p>

      <h2>Contact</h2>
      <p>
        {DEVELOPER_NAME} — <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </p>
    </main>
  );
}
