import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LicenseSection from "../LicenseSection";
import { ToastProvider } from "../../../contexts/ToastContext";

// Synthetic fixtures only: keys like these, emails @example.test.
export const GUM_KEY = "00000000-11111111-22222222-33333333";
export const LS_KEY = "00000000-1111-2222-3333-444444444444";
export const SUPPORT = "help@example.test";
export const FALLBACK_SUPPORT =
  "the seller (the contact address is on your receipt)";
export const GUM_BUTTON = "Activate (contacts Gumroad once)";
export const LS_BUTTON = "Activate (contacts Lemon Squeezy once)";

export const STORES = [
  { id: "gumroad", label: "Gumroad", configured: true },
  { id: "lemonsqueezy", label: "Lemon Squeezy", configured: true },
];

export const GUM_LICENSE = {
  store: "gumroad",
  storeLabel: "Gumroad",
  edition: "standard",
  purchaseDate: "2026-09-30T14:02:11Z",
  updatesUntil: "2027-09-30T14:02:11Z",
  expiresAt: null,
  activatedAt: "2026-10-05T12:00:00Z",
  email: "sam@example.test",
  keyLast4: "3333",
  test: false,
  canDeactivate: false,
};
export const LS_LICENSE = {
  ...GUM_LICENSE,
  store: "lemonsqueezy",
  storeLabel: "Lemon Squeezy",
  keyLast4: "4444",
  canDeactivate: true,
};

export const PURCHASE_URL = "https://example.com/l/pro";

export const TRIAL_AVAILABLE = {
  state: "available",
  startedAt: null,
  endsAt: null,
  daysLeft: null,
  remindToday: false,
  notice: null,
};
export const TRIAL_ACTIVE = {
  state: "active",
  startedAt: "2026-10-05T00:00:00Z",
  endsAt: "2026-10-19T00:00:00Z",
  daysLeft: 5,
  remindToday: false,
  notice: null,
};
export const TRIAL_ENDED = {
  state: "ended",
  startedAt: null,
  endsAt: null,
  daysLeft: 0,
  remindToday: false,
  notice: null,
};

export const FREE_MESSAGE =
  "You're using Local App Studio Free. Everything in the free version is included. If you bought Local App Studio Pro, paste your license key below and click Activate.";

export const status = (over = {}) => ({
  state: "pro",
  pro: true,
  edition: "standard",
  reasons: [],
  message: "Local App Studio Pro is active. Thank you for supporting Local App Studio.",
  invalidReason: null,
  license: GUM_LICENSE,
  trialDaysLeft: null,
  build: { date: "2026-09-01T00:00:00Z", source: "bundled", version: "1.2.0" },
  clock: { rollbackDetected: false },
  licenseState: "pro",
  proSource: "license",
  trial: TRIAL_AVAILABLE,
  perks: {},
  stores: STORES,
  // Empty as shipped (config/store.json proPurchaseUrl): the Buy button stays hidden unless a test sets it.
  purchaseUrl: null,
  supportContact: SUPPORT,
  ...over,
});
export const FREE = status({
  state: "free",
  pro: false,
  edition: null,
  license: null,
  licenseState: "free",
  proSource: null,
  message: FREE_MESSAGE,
});
export const lsActive = (over = {}) => status({ license: LS_LICENSE, ...over });

export function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <LicenseSection />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

export const apiError = (code, message, httpStatus = 422) =>
  Object.assign(new Error(message), { status: httpStatus, code });

export const keyInput = () => screen.findByLabelText("License key");

export async function paste(user, text) {
  const box = await keyInput();
  await user.click(box);
  await user.paste(text);
  return box;
}
