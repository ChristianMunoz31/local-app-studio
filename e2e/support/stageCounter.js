// Per-stage action counter for the phase 17 journeys: the journey() counter (pages/journey.js) with a current stage, so a journey can
// report how many actions each of Prompt, Design, Data, Preview, Build and Feature builder took.
//
//   const j = stagedJourney(page);
//   j.stage('Prompt'); await j.fill(...); await j.click(...);
//   j.stage('Design'); ...
//   j.report(test.info(), 'freelancer');   // annotation + console line, returns { Prompt: 2, Design: 5, ... }
import { journey } from '../pages/journey.js';

export const STAGES = ['Prompt', 'Design', 'Data', 'Preview', 'Build', 'Feature builder'];

/** @param {import('@playwright/test').Page} page */
export function stagedJourney(page) {
  const j = journey(page);
  /** @type {Record<string, number>} */
  const totals = Object.fromEntries(STAGES.map((s) => [s, 0]));
  let current = 'Prompt';
  let mark = 0;
  const close = () => {
    const n = j.counts().actions;
    totals[current] += n - mark;
    mark = n;
  };
  return {
    ...j,
    /** Starts counting the actions that follow under this stage. */
    stage(name) {
      if (!STAGES.includes(name)) throw new Error(`Unknown stage: ${name}`);
      close();
      current = name;
    },
    /** The actions per stage so far. */
    perStage() {
      close();
      return { ...totals };
    },
    /** Prints the per-stage counts and adds them to the test's annotations. */
    report(info, who) {
      close();
      const used = STAGES.filter((s) => totals[s] > 0).map((s) => `${s} ${totals[s]}`);
      const note = `${who} journey actions per stage: ${used.join(', ')}; total ${j.counts().actions}`;
      info.annotations.push({ type: 'measured', description: note });
      console.log(note);
      return { ...totals };
    },
  };
}
