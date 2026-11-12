// Testing Library waits for findBy* and waitFor. Its default is 1000 ms, which a heavy screen (DesignTab with a lazy
// dialog) can miss when the machine runs other suites at the same time; the assertion itself is unchanged, only the
// patience. Each test still has the frontend project's testTimeout as the hard stop.
import { configure } from '@testing-library/dom';

configure({ asyncUtilTimeout: 5000 });
