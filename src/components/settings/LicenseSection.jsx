import { useRef, useState } from "react";
import { BadgeCheck } from "lucide-react";
import SectionCard from "../shared/SectionCard";
import { sectionProps } from "./settingsSections";
import { ListSkeleton } from "../shared/Skeleton";
import { BTN, PILL, TONE_CLASS } from "./pillStyles";
import { useLicense } from "../../hooks/useLicense";
import BuyProLink from "../license/BuyProLink";
import { useToast } from "../../contexts/ToastContext";
import { GUMROAD, LEMON_SQUEEZY } from "../../constants/licenseStores";
import ActivateLicenseForm from "./ActivateLicenseForm";
import LicenseConfirmAction from "./LicenseConfirmAction";
import {
  NO_STORE_COPY,
  PROMISE,
  SUPPORT_FALLBACK,
} from "./licenseCopy";

const HINT = "text-xs text-slate-slate400";
// Neutral informational tone, so the test-purchase badge reads differently from the warn-toned "Pro off" pill.
const INFO_TONE = "bg-accent-blue/15 text-accent-blue";

const EDITION_LABELS = {
  standard: "Standard",
  founding: "Founding",
  family: "Family (up to 5 people)",
  student: "Student",
  nonprofit: "Nonprofit",
  trial: "Trial",
};

const YEARLY_EDITIONS = ["student", "nonprofit"];

const removeQuestion = (store, label) =>
  `This removes the license from this computer only. ${label} still counts this activation.${
    store === LEMON_SQUEEZY
      ? " To free the activation at Lemon Squeezy, use Move to another computer instead."
      : ""
  }`;
const MOVE_QUESTION =
  "This frees this computer's activation at Lemon Squeezy so you can activate Local App Studio on another computer, and turns Pro off here. Local App Studio contacts Lemon Squeezy once.";

/** Date only, in the user's locale. UTC so the date matches the one stored with the license. */
function formatLicenseDate(value) {
  if (typeof value !== "string") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

const dayWord = (n) => `${n} ${n === 1 ? "day" : "days"}`;
const trialDays = (n) => (Number.isFinite(n) ? Math.ceil(Math.max(0, n)) : null);

/** The server's fixed copy for the state. */
function messageFor(status) {
  return typeof status.message === "string" ? status.message.trim() : "";
}

/** Spec section 6 sentence. Falls back to the generic copy when the update date is unknown. */
function updateWindowBody(status) {
  const until = formatLicenseDate(status.license?.updatesUntil);
  if (!until) return messageFor(status);
  const version = status.build?.version ? ` (${status.build.version})` : "";
  const released = formatLicenseDate(status.build?.date);
  const when = released
    ? `was released on ${released}, after your updates ended on ${until}`
    : `was released after your updates ended on ${until}`;
  return `This version${version} ${when}. Pro is off in this version only; your data is untouched. Every Local App Studio version released on or before ${until} keeps Pro forever.`;
}

/** Title, tone and body copy for each license state. */
function describeState(status) {
  switch (status.state) {
    case "pro":
      return { title: "Pro", tone: "ok", body: messageFor(status) };
    case "licensing_off":
      return { title: "Licensing is off", tone: "muted", body: messageFor(status) };
    case "trial": {
      const days = trialDays(status.trialDaysLeft);
      return {
        title: days === null ? "Trial" : `Trial: ${dayWord(days)} left`,
        tone: "ok",
        body:
          days === null
            ? "Your Pro trial is active."
            : `Your Pro trial is active: ${dayWord(days)} left.`,
      };
    }
    case "update_window_passed":
      return {
        title: "Update window passed",
        tone: "warn",
        body: updateWindowBody(status),
      };
    case "expired":
      return {
        title: "Expired",
        tone: "warn",
        body: messageFor(status),
      };
    case "clock_issue":
      return {
        title: "Clock issue detected",
        tone: "warn",
        body: messageFor(status),
      };
    case "invalid":
      return {
        title: "Invalid license",
        tone: "warn",
        body: messageFor(status),
      };
    default:
      return { title: "Free", tone: "muted", body: messageFor(status) };
  }
}


function Detail({ label, children }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className={HINT}>{label}</dt>
      <dd className="text-slate-slate200">{children}</dd>
    </div>
  );
}

/** Student and nonprofit licenses are yearly: say when to renew, or how to turn Pro back on. */
function renewalText(license, status, ends) {
  if (!YEARLY_EDITIONS.includes(license.edition) || !ends) return "";
  if ((status.licenseState ?? status.state) === "expired")
    return "Get a new key to turn Pro back on.";
  return `Renews yearly: get a new key before ${ends}`;
}

function LicenseDetails({ license, status }) {
  const ends = license.expiresAt ? formatLicenseDate(license.expiresAt) : "";
  const renewal = renewalText(license, status, ends);
  return (
    <dl className="mt-3 space-y-1 text-xs">
      <Detail label="Edition">
        {EDITION_LABELS[license.edition] ?? license.edition}
      </Detail>
      <Detail label="Store">
        Bought from {license.storeLabel || license.store}
      </Detail>
      <Detail label="Purchase date">
        {formatLicenseDate(license.purchaseDate)}
      </Detail>
      <Detail label="Updates until">
        {formatLicenseDate(license.updatesUntil)}
      </Detail>
      {ends && <Detail label="Ends">{ends}</Detail>}
      <Detail label="Key">Key ending in {license.keyLast4}</Detail>
      {license.email && <Detail label="Email">{license.email}</Detail>}
      {renewal && <Detail label="Renewal">{renewal}</Detail>}
    </dl>
  );
}

/** The local 14-day trial starts by itself: see when it ends, or see that it ended. */
function TrialBlock({ trial, clockIssue }) {
  if (trial.state === "active") {
    const ends = formatLicenseDate(trial.endsAt);
    return ends ? (
      <p className="mt-2 text-xs text-slate-slate300">
        Your Pro trial ends on {ends}. After that Local App Studio switches to Free
        and keeps all your data.
      </p>
    ) : null;
  }
  if (trial.state === "ended") {
    // The clock message already explains why Pro is off.
    if (clockIssue) return null;
    return (
      <div className="mt-2">
        <p className="text-xs text-slate-slate300">
          Your trial ended. Your data is all here.
        </p>
        <p className={HINT}>
          Pro features are off. Everything in Local App Studio Free keeps working.
        </p>
      </div>
    );
  }
  return null;
}

export default function LicenseSection() {
  const {
    status,
    isLoading,
    isFetching,
    refetch,
    activate,
    deactivate,
    remove,
  } = useLicense();
  const toast = useToast();
  const titleRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(false);

  /** Runs one mutation with the shared busy flag; errors go back to the caller's own error slot. */
  const run = async (action, message) => {
    setNotice("");
    setBusy(true);
    try {
      await action();
      setNotice(message);
      toast({ message, type: "success" });
      titleRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const onActivate = async (licenseKey, store) => {
    await run(() => activate({ licenseKey, store }), "License activated.");
    setShowForm(false);
  };
  const onMove = (licenseKey) =>
    run(
      () => deactivate(licenseKey ? { licenseKey } : {}),
      "License released. You can activate it on your other computer now.",
    );
  const onRemove = () =>
    run(() => remove(), "License removed from this computer.");

  const view = status ? describeState(status) : null;
  const license = status?.license ?? null;
  const stores = (status?.stores ?? []).filter((s) => s.configured);
  const support = status?.supportContact || null;
  const trial =
    status && status.proSource !== "license" && status.proSource !== "licensing_off"
      ? status.trial
      : null;
  // An ended license asks for a new key right away; an active one hides the form behind "Use a different key".
  const formOpen = !license || status?.state === "expired" || showForm;
  const licensingOff = status?.proSource === "licensing_off";

  return (
    <SectionCard
      {...sectionProps("license")}
      title="License"
      subtitle={
        licensingOff
          ? "Every feature is available in this copy."
          : "Paste the license key from your Local App Studio Pro purchase, then click Activate."
      }
      icon={BadgeCheck}
    >
      {isLoading ? (
        <ListSkeleton rows={3} />
      ) : !status ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm text-accent-amber">
            Couldn&apos;t load your license status.
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className={BTN}
          >
            {isFetching ? "Retrying..." : "Retry"}
          </button>
        </div>
      ) : (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4
              ref={titleRef}
              tabIndex={-1}
              data-testid="license-state"
              className="text-sm font-semibold text-slate-slate100 focus:outline-hidden"
            >
              {view.title}
            </h4>
            <span className={`${PILL} ${TONE_CLASS[view.tone]}`}>
              {status.pro ? "Pro on" : "Pro off"}
            </span>
            {license?.test && (
              <span className={`${PILL} ${INFO_TONE}`}>Test purchase</span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-slate300">{view.body}</p>
          {license && <LicenseDetails license={license} status={status} />}

          {license && (
            <div className="mt-3 space-y-2">
              {license.store === GUMROAD && (
                <p className={HINT}>
                  To use Local App Studio on a new computer beyond your limit, email{" "}
                  {support ?? SUPPORT_FALLBACK} to reset your activations.
                </p>
              )}
              <div className="flex flex-wrap items-start gap-2">
                {license.canDeactivate && (
                  <LicenseConfirmAction
                    triggerLabel="Move to another computer"
                    groupLabel="Confirm moving your license"
                    question={MOVE_QUESTION}
                    confirmLabel="Move license"
                    busy={busy}
                    onConfirm={onMove}
                    askForKey
                  />
                )}
                <LicenseConfirmAction
                  triggerLabel="Remove from this computer"
                  groupLabel="Confirm license removal"
                  question={removeQuestion(
                    license.store,
                    license.store === LEMON_SQUEEZY ? "Lemon Squeezy" : "Gumroad",
                  )}
                  confirmLabel="Remove"
                  busy={busy}
                  onConfirm={onRemove}
                />
                {!formOpen && stores.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowForm(true)}
                    disabled={busy}
                    className={BTN}
                  >
                    Use a different key
                  </button>
                )}
              </div>
            </div>
          )}

          {trial && (
            <TrialBlock
              trial={trial}
              clockIssue={status.state === "clock_issue"}
            />
          )}

          <div className="mt-4 border-t border-[color:var(--glass-border)] pt-4">
            {formOpen &&
              !licensingOff &&
              (stores.length === 0 ? (
                <p className="text-sm text-slate-slate300">{NO_STORE_COPY}</p>
              ) : (
                <>
                  <h4 className="mb-3 text-sm font-semibold text-slate-slate100">
                    Activate a license
                  </h4>
                  <ActivateLicenseForm
                    stores={stores}
                    busy={busy}
                    onActivate={onActivate}
                    replaceHint={Boolean(license)}
                  />
                </>
              ))}
            {/* Visible only: the toast's live region already announces the same message. */}
            {notice && (
              <p
                data-testid="license-notice"
                className="mt-2 text-xs text-accent-green"
              >
                {notice}
              </p>
            )}
            {!license && !licensingOff && (
              <div className="mt-3 flex">
                <BuyProLink />
              </div>
            )}
            {!licensingOff && <p className={`mt-3 ${HINT}`}>{PROMISE}</p>}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
