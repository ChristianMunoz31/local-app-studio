// Click and key counter for the proof flows (DESIGN-phase12.md 2.9 and WP-5).
//
//   const j = journey(page);
//   await j.click(locator); await j.fill(locator, 'text'); await j.press('Tab');
//   expect(j.counts().actions).toBeLessThanOrEqual(4);
//
// click, dblclick, fill, select and a press of Enter or Space count as actions; every press counts as a key
// (so Enter is both an action and a key). Steps a flow does outside the counter (API setup, waiting, asserting) are free.
export function journey(page) {
  let actions = 0;
  let keys = 0;
  const log = [];
  const note = (kind, what) => log.push(`${kind}: ${what}`);
  return {
    async click(locator, options) {
      actions += 1;
      note('click', String(locator));
      await locator.click(options);
    },
    async dblclick(locator, options) {
      actions += 1;
      note('dblclick', String(locator));
      await locator.dblclick(options);
    },
    async fill(locator, text) {
      actions += 1;
      note('fill', String(locator));
      await locator.fill(text);
    },
    async select(locator, option) {
      actions += 1;
      note('select', String(locator));
      await locator.selectOption(option);
    },
    /** One key press (a chord such as Shift+Tab is one press). Enter and Space also count as an action. */
    async press(key) {
      keys += 1;
      if (key === 'Enter' || key === 'Space' || key === ' ') actions += 1;
      note('press', key);
      await page.keyboard.press(key);
    },
    /** Types a whole phrase: counted as ONE key press (the phrase is one entry, not one key per letter). */
    async typeText(text) {
      keys += 1;
      note('type', text);
      await page.keyboard.type(text);
    },
    counts() {
      return { actions, keys };
    },
    /** What was counted, in order, for a failure message. */
    trail() {
      return log.join('\n');
    },
  };
}

/** The words that must never show on a Studio screen (glossary "never shown" list). */
export const NEVER_SHOWN = /\b(spec|AppSpec|JSON|schema|slot|source|undefined|specVersion|DataTable|SearchBox|QuickAdd|toolchain|rustc)\b/;

/**
 * The same list without "slot", for the Feature builder screens only (/features/new, /features/:id/edit and its dialogs): the builder says
 * "Add a table slot", "Uses slot" and the Slots panel on purpose (DESIGN-phase16.md 4.1). Every other screen keeps NEVER_SHOWN.
 */
export const NEVER_SHOWN_BUILDER = /\b(spec|AppSpec|JSON|schema|source|undefined|specVersion|DataTable|SearchBox|QuickAdd|toolchain|rustc)\b/;
