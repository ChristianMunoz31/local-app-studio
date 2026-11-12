import { useEffect } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ListSkeleton } from '../shared/Skeleton';
import { BTN, PILL, TONE_CLASS } from './pillStyles';
import { networkActivityService } from '../../services/networkActivityService';
import { PRODUCT_NAME, PRODUCT_NAME_START as SENTENCE_START, useHiddenNetworkFeatures } from '../../hooks/useHiddenNetworkFeatures';

const RESULT_TONE = { ok: TONE_CLASS.ok, blocked: TONE_CLASS.muted, failed: TONE_CLASS.warn };
// An empty page that still has older rows to look at is fetched on its own, up to this many pages in all.
const AUTO_PAGES = 5;
const LOAD_ERROR = "Couldn't load network activity. Close and reopen Settings to try again.";

/** Local time for a row; the year is added when it is not the current year. */
const formatTime = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown time';
  const options = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  if (d.getFullYear() !== new Date().getFullYear()) options.year = 'numeric';
  return d.toLocaleString([], options);
};

/** The outbound connections Local App Studio (or the built app) has made, read from the activity log. Feature, host, time and result only. */
export default function NetworkActivityPanel() {
  // A built app with no update check does not name one in its empty state (unless update checks are on).
  const hasUpdates = !useHiddenNetworkFeatures().includes('updates');
  const query = useInfiniteQuery({
    queryKey: ['network-activity'],
    queryFn: ({ pageParam, signal }) => networkActivityService.list({ before: pageParam, signal }),
    initialPageParam: null,
    getNextPageParam: (page) => page.nextBefore ?? undefined,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const entries = (query.data?.pages ?? []).flatMap((p) => p.entries);
  const pageCount = query.data?.pages.length ?? 0;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const autoFetching = entries.length === 0 && hasNextPage && !query.error && pageCount < AUTO_PAGES;

  useEffect(() => {
    if (autoFetching && !isFetchingNextPage) fetchNextPage();
  }, [autoFetching, isFetchingNextPage, fetchNextPage, pageCount]);

  const loadMore = hasNextPage && (
    <div className="mt-3 flex justify-center">
      <button
        type="button"
        onClick={() => {
          if (!isFetchingNextPage) fetchNextPage();
        }}
        aria-disabled={isFetchingNextPage}
        aria-busy={isFetchingNextPage}
        className={BTN}
      >
        {isFetchingNextPage ? 'Loading...' : 'Load more'}
      </button>
    </div>
  );
  // A failed Load more keeps the pages already loaded and offers a retry of the same page.
  const pageError = query.error && query.data && (
    <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 text-sm text-accent-amber">
      <span>{LOAD_ERROR}</span>
      <button type="button" onClick={() => fetchNextPage()} className={BTN}>
        Retry
      </button>
    </div>
  );

  let body;
  if (query.isPending || autoFetching) {
    body = (
      <div role="status">
        <span className="sr-only">Loading network activity</span>
        <ListSkeleton rows={3} />
      </div>
    );
  } else if (query.error && !query.data) {
    body = (
      <p role="alert" className="text-sm text-accent-amber">
        {LOAD_ERROR}
      </p>
    );
  } else if (entries.length === 0 && hasNextPage) {
    body = (
      <div className="text-sm text-slate-slate300">
        <p className="font-semibold text-slate-slate100">No connections in recent activity.</p>
        <p className="mt-1 text-xs text-slate-slate400">Older activity may have some. Choose Load more to keep looking.</p>
        {pageError}
        {loadMore}
      </div>
    );
  } else if (entries.length === 0) {
    body = (
      <div className="text-sm text-slate-slate300">
        <p className="font-semibold text-slate-slate100">{SENTENCE_START} hasn&apos;t connected to the internet.</p>
        <p className="mt-1 text-xs text-slate-slate400">{hasUpdates ? 'It only connects for features you turn on, like update checks.' : 'It only connects for features you turn on.'}</p>
      </div>
    );
  } else {
    body = (
      <>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Internet connections {PRODUCT_NAME} made, newest first</caption>
            <thead>
              <tr className="text-xs text-slate-slate400">
                <th scope="col" className="py-1 pr-3 font-semibold">Feature</th>
                <th scope="col" className="py-1 pr-3 font-semibold">Host</th>
                <th scope="col" className="py-1 pr-3 font-semibold">Time</th>
                <th scope="col" className="py-1 font-semibold">Result</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-[color:var(--glass-border)] align-top">
                  <td className="py-2 pr-3 font-semibold text-slate-slate100">{e.label}</td>
                  <td className="break-all py-2 pr-3 font-mono text-xs text-slate-slate300">{e.host}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-xs text-slate-slate400">
                    <time dateTime={e.at}>{formatTime(e.at)}</time>
                  </td>
                  <td className="py-2">
                    <span className={`${PILL} ${RESULT_TONE[e.result] ?? TONE_CLASS.warn}`}>
                      {Object.hasOwn(RESULT_TONE, e.result) ? e.result : 'failed'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pageError}
        {loadMore}
      </>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-slate400">
        Connections {PRODUCT_NAME} made for features you turned on, newest first, for up to 90 days. Only the feature, the host, the time and
        the result are kept. What you typed or saved is never shown here.
      </p>
      {body}
    </div>
  );
}
