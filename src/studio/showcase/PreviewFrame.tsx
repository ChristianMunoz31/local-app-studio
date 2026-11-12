// The picture of one entry: the runtime's own renderer over sample rows, scaled to fit a fixed box. Loaded lazily by the
// tile and the drawer; the preview itself mounts only once the frame is near the viewport.
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import type { FeatureLibrary } from '@/catalog/features';
import { CatalogPageProvider } from '@/catalog/context';
import type { Theme } from '@local-app-studio/runtime/spec/schema';
import SpecRenderer from '@local-app-studio/runtime/runtime/SpecRenderer.jsx';
import ThemeScope from '@/studio/theme/ThemeScope';
import type { ShowcaseEntry } from './entries';
import { DESIGN_WIDTH, FRAME_CLASS } from './frame';
import { previewModelFor } from './samples';
import type { PreviewModel } from './samples';
import ScaleToFit from './ScaleToFit';
import { useInView } from './useInView';

export interface PreviewFrameProps {
  entry: ShowcaseEntry;
  library: FeatureLibrary;
  size: 'sm' | 'md' | 'lg';
  /** The look to draw in. Without it the preview shows the surrounding look. */
  theme?: Theme;
}

const BOX = 'relative w-full overflow-hidden rounded-md bg-slate-slate800/40';
const NOTE = 'flex h-full items-center justify-center px-3 text-center text-xs text-slate-slate400';

function safeModel(entry: ShowcaseEntry, library: FeatureLibrary): PreviewModel | null {
  try {
    return previewModelFor(entry, library);
  } catch {
    return null;
  }
}

function withTheme(content: ReactNode, theme: Theme | undefined): ReactNode {
  if (!theme) return content;
  return (
    <ThemeScope theme={theme} className="h-full w-full">
      {content}
    </ThemeScope>
  );
}

export default function PreviewFrame({ entry, library, size, theme }: PreviewFrameProps) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const model = useMemo(() => (inView ? safeModel(entry, library) : null), [inView, entry, library]);

  return (
    <div ref={ref} className={`${BOX} ${FRAME_CLASS[size]}`} data-testid="preview-frame" data-in-view={inView ? 'true' : 'false'}>
      {inView &&
        (model === null ? (
          <p className={NOTE}>This preview could not be shown.</p>
        ) : (
          withTheme(
            <ScaleToFit designWidth={DESIGN_WIDTH[entry.category]}>
              <CatalogPageProvider value={model.data}>
                <SpecRenderer layer={model.layer} />
              </CatalogPageProvider>
            </ScaleToFit>,
            theme,
          )
        ))}
    </div>
  );
}
