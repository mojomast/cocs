// Opt-in gate for long-running tests.
//
// A handful of tests simulate multi-minute matches, or rasterize through the
// software 3D fallback, which takes minutes on a machine without 3D hardware.
// They are skipped by default so `npm run test:game` always finishes quickly
// and never *looks* hung; run them explicitly with COCS_SLOW_TESTS=1 (or
// `npm run test:game:slow`) on a machine with time/GPU budget.
export const SLOW_TESTS_ENV = 'COCS_SLOW_TESTS';

export function slowTestsEnabled() {
  return process.env[SLOW_TESTS_ENV] === '1';
}

// Returns `false` to run, or a skip reason string. Feed straight into
// `test(name, { skip: slowSkip(reason) }, fn)`.
export function slowSkip(reason) {
  return slowTestsEnabled() ? false : (reason || `slow test: set ${SLOW_TESTS_ENV}=1 to run`);
}
