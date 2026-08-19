// Smoke test for the package-manager detection and install plans.
//
// It builds a throwaway project per manager, runs the plan the action would run, then scans the
// result with the same license tool. The assertion that matters is the package COUNT: a wrong
// node_modules layout does not error, it silently reports a handful of packages, which the action
// would render as a clean licence report.
//
// Run with: npx tsc --outDir .smoke-build --noEmit false && node scripts/smoke-package-managers.mjs

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { detectPackageManager, buildInstallPlan, preparePackageManager } = await import("../.smoke-build/packagemanager.js");

// chalk pulls in a small, stable transitive tree; anything under this means the scanner is only
// seeing direct dependencies.
const DEPENDENCIES = { chalk: "4.1.2" };
const MIN_PACKAGES = 5;

// Each case is detected the way a real repository would be: from a lockfile, or from the
// packageManager field. The lockfiles are minimal stubs; every manager rewrites its own on install.
const CASES = [
  { name: "npm", expect: "npm", files: { "package-lock.json": '{ "lockfileVersion": 3 }\n' } },
  { name: "yarn-classic", expect: "yarn", files: { "yarn.lock": "# yarn lockfile v1\n\n" } },
  { name: "pnpm", expect: "pnpm", files: { "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" } },
  { name: "yarn-berry", expect: "yarn", berry: true, packageManager: "yarn@4.9.1" },
];

const root = fs.mkdtempSync(path.join(os.tmpdir(), "acl-smoke-"));
let failures = 0;

/**
 * Run a command, returning stdout and never throwing.
 */
function run(command, args, cwd, env) {
  try {
    // Windows exposes these managers as .cmd shims, which execFileSync cannot spawn directly.
    const shell = process.platform === "win32";
    return { ok: true, out: execFileSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: "utf8", stdio: "pipe", shell }) };
  } catch (error) {
    return { ok: false, out: `${error.stdout ?? ""}\n${error.stderr ?? ""}`.trim() };
  }
}

for (const testCase of CASES) {
  const dir = path.join(root, testCase.name);
  fs.mkdirSync(dir, { recursive: true });

  const manifest = { name: `smoke-${testCase.name}`, version: "1.0.0", private: true, dependencies: DEPENDENCIES };
  if (testCase.packageManager) manifest.packageManager = testCase.packageManager;
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest, null, 2));

  for (const [file, contents] of Object.entries(testCase.files ?? {})) {
    fs.writeFileSync(path.join(dir, file), contents);
  }

  const info = detectPackageManager(dir, { override: "auto" });
  const detectedOk = info.name === testCase.expect && Boolean(info.berry) === Boolean(testCase.berry);
  if (!detectedOk) {
    console.error(`FAIL ${testCase.name}: detected ${info.name}${info.berry ? " (berry)" : ""}, expected ${testCase.expect}${testCase.berry ? " (berry)" : ""}`);
    failures++;
    continue;
  }

  // preparePackageManager reconciles the detected flavour with the binary actually on PATH, which
  // is the behaviour under test as much as the plan itself.
  const prepared = await preparePackageManager(info, dir);
  if (prepared.error) {
    console.error(`FAIL ${testCase.name}: ${prepared.error}`);
    failures++;
    continue;
  }
  const plan = buildInstallPlan(prepared.info, true);

  // Yarn berry turns on immutable installs in CI, and these fixtures are generated fresh with no
  // committed lockfile, so berry would refuse to write one. A real berry repository commits its
  // lockfile, which is why the action deliberately does not override this itself.
  const fixtureEnv = prepared.info.berry ? { ...plan.env, YARN_ENABLE_IMMUTABLE_INSTALLS: "false" } : plan.env;

  const install = run(plan.command, plan.args, dir, fixtureEnv);
  if (!install.ok) {
    console.error(`FAIL ${testCase.name}: ${plan.command} ${plan.args.join(" ")} failed\n${install.out.slice(-1500)}`);
    failures++;
    continue;
  }

  const scan = run("npx", ["--yes", "license-compliance@2", "--production", "--format", "json", "--report", "detailed"], dir);
  const start = scan.out.indexOf("[");
  const end = scan.out.lastIndexOf("]");
  let count = -1;
  if (start !== -1 && end > start) {
    try {
      count = JSON.parse(scan.out.slice(start, end + 1)).length;
    } catch {
      count = -1;
    }
  }

  if (count < MIN_PACKAGES) {
    console.error(`FAIL ${testCase.name}: scanner reported ${count} packages, expected at least ${MIN_PACKAGES} (wrong node_modules layout?)`);
    failures++;
    continue;
  }

  console.log(`ok   ${testCase.name.padEnd(13)} ${prepared.info.name}${prepared.info.berry ? "/berry" : ""} -> ${count} packages`);
}

fs.rmSync(root, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} package manager smoke test(s) failed`);
  process.exit(1);
}
console.log("\nAll package manager smoke tests passed");
