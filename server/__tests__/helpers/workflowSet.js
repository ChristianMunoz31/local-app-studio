// Which workflow set is checked out: the private nine (this repo) or the public two the export swaps in
// (scripts/release/public-overlay/.github/workflows, marked `# las-workflow-set: public`). A test that pins a private
// workflow file skips itself in the export, with its reason in the title:
//
//   import { PRIVATE_WORKFLOWS } from './helpers/workflowSet.js';
//   it.skipIf(!PRIVATE_WORKFLOWS)('x (pins a private workflow, which is not in a public export)', () => { ... });
//   describe.skipIf(!PRIVATE_WORKFLOWS)('x (pins private workflows, which are not in a public export)', () => { ... });
import { REPO_ROOT } from '../../../scripts/checks/gitFiles.js';
import { detectWorkflowSet } from '../../../scripts/ci/workflowCheck.js';

export const WORKFLOW_SET = detectWorkflowSet(REPO_ROOT);
export const PRIVATE_WORKFLOWS = WORKFLOW_SET === 'private';
