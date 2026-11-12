// Sizes shared by the preview frame and the placeholder the tile shows while the frame loads.
import type { ShowcaseCategory } from './entries';

/** Width in px a preview is drawn at before it is shrunk to its box. */
export const DESIGN_WIDTH: Readonly<Record<ShowcaseCategory, number>> = { data: 720, custom: 640, layout: 560, navigation: 560, input: 480, action: 360 };

export const FRAME_CLASS: Readonly<Record<'sm' | 'md' | 'lg', string>> = { sm: 'h-20', md: 'aspect-video', lg: 'aspect-video' };

/** The scale that fits content of w x h into a box of boxW x boxH, never above 1. */
export function fitScale(boxW: number, boxH: number, w: number, h: number): number {
  if (boxW <= 0 || boxH <= 0 || w <= 0 || h <= 0) return 1;
  return Math.min(boxW / w, boxH / h, 1);
}
