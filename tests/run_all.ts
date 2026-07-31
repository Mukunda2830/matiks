/**
 * run_all.ts
 * Consolidated Test Suite Runner for Player Reward Rule Engine.
 * Executes all 4 tiers (Tiers 1-4) sequentially using Node's test runner,
 * aggregates pass/fail counts per tier, and provides a clear summary report.
 */

import { execSync } from 'child_process';

interface TierResult {
  tierName: string;
  command: string;
  success: boolean;
  output: string;
}

function runTier(tierName: string, pattern: string): TierResult {
  const cmd = `node --experimental-strip-types --test ${pattern}`;
  console.log(`\n==================================================`);
  console.log(` Running ${tierName}...`);
  console.log(` Command: ${cmd}`);
  console.log(`==================================================`);

  try {
    const output = execSync(cmd, { cwd: process.cwd(), encoding: 'utf-8' });
    console.log(output);
    return { tierName, command: cmd, success: true, output };
  } catch (err: any) {
    const output = err.stdout || err.stderr || err.message;
    console.error(output);
    return { tierName, command: cmd, success: false, output };
  }
}

function main() {
  console.log(`\n=======================================================`);
  console.log(` PLAYER REWARD RULE ENGINE — E2E TEST SUITE RUNNER`);
  console.log(`=======================================================`);

  const results: TierResult[] = [];

  results.push(runTier('Tier 1: Feature Coverage (F1-F10)', 'tests/tier1/*.test.ts'));
  results.push(runTier('Tier 2: Boundary & Corner Cases', 'tests/tier2/*.test.ts'));
  results.push(runTier('Tier 3: Cross-Feature Combinations', 'tests/tier3/*.test.ts'));
  results.push(runTier('Tier 4: Real-World Workload Scenarios', 'tests/tier4/*.test.ts'));

  console.log(`\n=======================================================`);
  console.log(` SUMMARY OF TEST RESULTS ACROSS ALL TIERS`);
  console.log(`=======================================================`);

  let allPassed = true;
  for (const res of results) {
    const statusStr = res.success ? '✔ PASSED' : '✖ FAILED';
    console.log(`- ${res.tierName.padEnd(40)} : ${statusStr}`);
    if (!res.success) allPassed = false;
  }

  console.log(`-------------------------------------------------------`);
  if (allPassed) {
    console.log(`🎉 OVERALL STATUS: ALL TEST TIERS PASSED CLEANLY (100%)`);
    process.exit(0);
  } else {
    console.error(`💥 OVERALL STATUS: SOME TEST TIERS FAILED`);
    process.exit(1);
  }
}

main();
