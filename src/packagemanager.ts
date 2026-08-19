import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as io from "@actions/io";
import * as fs from "fs";
import path from "path";

const supportedPackageManagers = ["npm", "yarn", "pnpm"] as const;

type SupportedPackageManager = (typeof supportedPackageManagers)[number];

/** Bun is recognised so it can be reported as unsupported instead of silently falling through to yarn. */
type DetectedPackageManager = SupportedPackageManager | "bun";

interface PackageManagerInfo {
  name: DetectedPackageManager;
  /** True for yarn 2+ ("berry"), which takes a different CLI and needs an explicit node-modules linker. */
  berry: boolean;
  /** The signal the decision came from, logged so a wrong detection is debuggable from the run log. */
  reason: string;
}

interface InstallPlan {
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface DetectOptions {
  /** The `packageManager` action input: "auto", or a name that overrides detection. */
  override: string;
}

const isSupported = (value: string): value is SupportedPackageManager => (supportedPackageManagers as readonly string[]).includes(value);

const exists = (folder: string, file: string): boolean => fs.existsSync(path.join(folder, file));

/**
 * read the `packageManager` field (the corepack convention) from a folder's package.json
 * @param folder the folder containing the package.json
 * @returns the raw field value, or undefined if absent or unreadable
 */
const readPackageManagerField = (folder: string): string | undefined => {
  try {
    const contents = fs.readFileSync(path.join(folder, "package.json"), "utf8");
    const parsed = JSON.parse(contents) as { packageManager?: unknown };
    return typeof parsed.packageManager === "string" ? parsed.packageManager : undefined;
  } catch {
    return undefined;
  }
};

/**
 * a yarn.lock written by yarn 2+ starts with a `__metadata:` block, a v1 lockfile never does
 * @param folder the folder containing the yarn.lock
 * @returns true if the lockfile was written by yarn berry
 */
const yarnLockIsBerry = (folder: string): boolean => {
  try {
    return fs.readFileSync(path.join(folder, "yarn.lock"), "utf8").slice(0, 4096).includes("__metadata:");
  } catch {
    return false;
  }
};

/**
 * decide which package manager a folder uses, without touching the network or spawning anything
 * @param folder the folder to inspect
 * @param options the action's packageManager override
 * @returns the detected manager plus the signal it was detected from
 */
const detectPackageManager = (folder: string, options: DetectOptions): PackageManagerInfo => {
  const override = options.override.trim().toLowerCase();

  if (override && override !== "auto") {
    if (!isSupported(override)) {
      throw new Error(`Unsupported packageManager input "${options.override}". Use one of: auto, ${supportedPackageManagers.join(", ")}.`);
    }
    return {
      name: override,
      berry: override === "yarn" && yarnLockIsBerry(folder),
      reason: `packageManager input set to "${override}"`,
    };
  }

  const field = readPackageManagerField(folder);
  if (field) {
    const [rawName, version = ""] = field.split("@");
    const name = rawName.trim().toLowerCase();
    const major = Number.parseInt(version.split(".")[0] ?? "", 10);
    if (name === "bun") {
      return { name: "bun", berry: false, reason: `packageManager field "${field}"` };
    }
    if (isSupported(name)) {
      return {
        name,
        berry: name === "yarn" && (Number.isNaN(major) ? yarnLockIsBerry(folder) : major >= 2),
        reason: `packageManager field "${field}"`,
      };
    }
  }

  if (exists(folder, "pnpm-lock.yaml")) {
    return { name: "pnpm", berry: false, reason: "found pnpm-lock.yaml" };
  }

  if (exists(folder, "yarn.lock")) {
    const berry = yarnLockIsBerry(folder);
    return { name: "yarn", berry, reason: `found yarn.lock (${berry ? "berry" : "classic"})` };
  }

  if (exists(folder, "package-lock.json") || exists(folder, "npm-shrinkwrap.json")) {
    return { name: "npm", berry: false, reason: "found package-lock.json" };
  }

  if (exists(folder, "bun.lock") || exists(folder, "bun.lockb")) {
    return { name: "bun", berry: false, reason: "found a bun lockfile" };
  }

  return { name: "yarn", berry: false, reason: "no lockfile found, falling back to yarn" };
};

/**
 * build the install invocation for a detected package manager
 *
 * Every manager is asked for a hoisted node_modules tree, because the license scanner enumerates
 * packages by walking node_modules: pnpm's default isolated layout and yarn berry's PnP layout
 * both hide transitive dependencies from it, which would report a near-empty (falsely clean) result.
 * @param info the detected package manager
 * @param ignoreScripts whether dependency lifecycle scripts should be skipped
 * @returns the command, arguments and environment overrides to run
 */
const buildInstallPlan = (info: PackageManagerInfo, ignoreScripts: boolean): InstallPlan => {
  switch (info.name) {
    case "npm":
      return { command: "npm", args: ["install", ...(ignoreScripts ? ["--ignore-scripts"] : [])], env: {} };

    case "pnpm":
      return {
        command: "pnpm",
        args: ["install", "--node-linker=hoisted", "--config.engine-strict=false", ...(ignoreScripts ? ["--ignore-scripts"] : [])],
        env: {},
      };

    case "yarn":
      return info.berry
        ? {
            command: "yarn",
            // YARN_IGNORE_PATH is deliberately not set: yarn 1.22 (which is what the runner images
            // ship as `yarn`) reaches a berry release by forwarding to the yarnPath from .yarnrc.yml,
            // and that variable is exactly what disables the forwarding.
            args: ["install", "--mode=skip-build"],
            env: { YARN_NODE_LINKER: "node-modules", ...(ignoreScripts ? { YARN_ENABLE_SCRIPTS: "false" } : {}) },
          }
        : {
            command: "yarn",
            args: ["install", "--ignore-engines", ...(ignoreScripts ? ["--ignore-scripts"] : [])],
            env: {},
          };

    case "bun":
      throw new Error("bun is not supported by this action. Set the packageManager input to npm, yarn or pnpm to override detection.");
  }
};

/**
 * read the major version the package manager binary reports in a given folder
 *
 * Run inside the project folder on purpose: for a yarn berry project this is what makes yarn 1.22
 * hand over to the release pinned by .yarnrc.yml, so the version reported is the one that will
 * actually perform the install.
 * @param command the binary to probe
 * @param cwd the folder to probe it in
 * @returns the major version, or undefined if the binary could not be run or parsed
 */
const readMajorVersion = async (command: string, cwd: string): Promise<number | undefined> => {
  const { exitCode, stdout } = await exec.getExecOutput(command, ["--version"], { cwd, silent: true, ignoreReturnCode: true });
  if (exitCode !== 0) {
    return undefined;
  }
  const major = Number.parseInt(stdout.trim().split(".")[0] ?? "", 10);
  return Number.isNaN(major) ? undefined : major;
};

/**
 * make sure a package manager that can actually perform this install is reachable
 *
 * Two separate problems. pnpm is absent from the GitHub-hosted images entirely, so corepack has to
 * provide it. yarn is always present, but which yarn it is decides the whole command shape -- and
 * the lockfile only says which one the project WANTS. So the flavour is reconciled against what the
 * binary actually reports, in both directions: a berry project on a classic yarn is escalated
 * through corepack, and a classic project that resolves to a berry yarn switches to the berry plan
 * rather than passing v1-only flags that berry rejects outright.
 *
 * Corepack is best-effort by design (it can fail for unrelated reasons and no longer ships with
 * Node from 25.0.0 on), so its exit code is ignored and the result is re-probed instead.
 * @param info the detected package manager
 * @param cwd the folder the install will run in
 * @returns the reconciled package manager, or the reason the install cannot proceed
 */
const preparePackageManager = async (info: PackageManagerInfo, cwd: string): Promise<{ info: PackageManagerInfo; error?: string }> => {
  // The binary name is the manager name for all three supported managers.
  const command = info.name;

  const enableViaCorepack = async (): Promise<void> => {
    core.info(`Trying to provision ${command} via corepack`);
    await exec
      .exec("corepack", ["enable", command], {
        // Corepack asks before downloading a version it does not have cached; on a runner there is
        // nobody to answer.
        env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" },
        silent: true,
        ignoreReturnCode: true,
      })
      .catch(() => 0);
  };

  if (!(await io.which(command))) {
    await enableViaCorepack();
    if (!(await io.which(command))) {
      return {
        info,
        error: `${command} is not available on this runner and corepack could not provide it; install it before this step (for example with pnpm/action-setup)`,
      };
    }
  }

  if (info.name !== "yarn") {
    return { info };
  }

  let major = await readMajorVersion(command, cwd);

  if (info.berry && (major === undefined || major < 2)) {
    // yarn 1.22 refuses to run at all in a project pinning a berry release, so an unreadable
    // version here means "not berry yet" rather than "no yarn".
    await enableViaCorepack();
    major = await readMajorVersion(command, cwd);
  }

  if (major === undefined) {
    return {
      info,
      error: "`yarn --version` could not be run in this project; add a corepack or yarn setup step before this one",
    };
  }

  if (info.berry && major < 2) {
    return {
      info,
      error: `this project uses yarn berry but the runner resolves yarn ${major}; add a corepack or yarn setup step before this one`,
    };
  }

  if (!info.berry && major >= 2) {
    core.info(`Detection said yarn classic but the resolved yarn is ${major}; using the berry install plan`);
    return { info: { ...info, berry: true, reason: `${info.reason}, resolved yarn ${major}` } };
  }

  return { info };
};

export { detectPackageManager, buildInstallPlan, preparePackageManager };
export type { PackageManagerInfo, InstallPlan, DetectedPackageManager };
