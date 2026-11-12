// `npm run doctor [-- --json] [-- --strict]`: checks this PC for what Local App Studio needs (phase 15, section 4).
// Prints the table, or the report as JSON. Exit 0; with --strict exit 1 when a line is Missing or a Problem.
// Under Vitest only, APP_DOCTOR_FAKE=<fixture path> replaces the machine with a fixture (a JSON DoctorReport).
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { formatDoctor, runDoctor } from '../server/diagnostics/doctor.js';

/**
 * @param {string[]} argv
 * @param {{ out?: (text: string) => void, err?: (text: string) => void, env?: Record<string, string | undefined>,
 *   run?: () => Promise<import('../server/diagnostics/doctor.js').DoctorReport> }} [io]
 * @returns {Promise<number>} the exit code
 */
export async function main(argv, { out = (t) => process.stdout.write(t), err = (t) => process.stderr.write(t), env = process.env, run } = {}) {
  const known = new Set(['--json', '--strict']);
  const unknown = argv.filter((a) => !known.has(a));
  if (unknown.length > 0) {
    err(`Unknown option: ${unknown[0]}\nUsage: npm run doctor [-- --json] [-- --strict]\n`);
    return 2;
  }
  let report;
  if (run) report = await run();
  else if (env.VITEST && env.APP_DOCTOR_FAKE) report = JSON.parse(fs.readFileSync(env.APP_DOCTOR_FAKE, 'utf8'));
  else report = await runDoctor();
  out(argv.includes('--json') ? `${JSON.stringify(report, null, 2)}\n` : formatDoctor(report));
  return argv.includes('--strict') && (report.counts.missing > 0 || report.counts.problem > 0) ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      process.stderr.write(`The check could not run: ${e?.code ?? e?.name ?? 'error'}\n`);
      process.exitCode = 1;
    },
  );
}
