import { useLicense } from '../../hooks/useLicense';
import { LINK_BTN } from '../settings/pillStyles';

/**
 * The "Buy Local App Studio Pro" link: a plain anchor to the owner's Pro page from `status.purchaseUrl`
 * (config/store.json `proPurchaseUrl`, empty as shipped). In the desktop app the shell cancels the navigation
 * and opens it in the default browser (src-tauri/src/nav.rs), so it is not an app network request. Renders
 * nothing while the status is unknown, when no https URL is configured, when licensing is off (Pro is
 * already on) or when a license is stored on this computer (any license record, including an ended one:
 * those users renew or get a new key, not a new purchase).
 * `className` replaces the default button style when a placement needs a quieter one.
 */
export default function BuyProLink({ className = LINK_BTN }) {
  const { status } = useLicense();
  const href = status?.purchaseUrl;
  if (typeof href !== 'string' || !/^https:\/\//i.test(href)) return null;
  if (status.license || status.proSource === 'license' || status.proSource === 'licensing_off' || status.licenseState === 'pro') return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      Buy Local App Studio Pro<span className="sr-only"> (opens in your browser)</span>
    </a>
  );
}
