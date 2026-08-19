import * as core from "@actions/core";

interface ActionConfig {
  blockedLicenses: string[];
  continueOnBlockedFound: boolean;
  ignoreFolders: string[];
  /** "auto" to detect per folder, or an explicit npm / yarn / pnpm. */
  packageManager: string;
  /** Scan whatever node_modules is already present instead of installing. */
  skipInstall: boolean;
  ignoreScripts: boolean;
}

/**
 * read a boolean input that tolerates an empty value
 *
 * `core.getBooleanInput` throws a TypeError on an empty string, and the defaults declared in
 * action.yml only apply when the key is absent from `with:` entirely -- so a caller who passes
 * `skipInstall: ${{ inputs.something }}` with an empty value would otherwise crash the action.
 * @param name the input name
 * @param fallback the value to use when the input is empty
 * @returns the parsed boolean
 */
const getBooleanInputOrDefault = (name: string, fallback: boolean): boolean => {
  const raw = core.getInput(name).trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  throw new Error(`Input "${name}" must be "true" or "false", got "${raw}".`);
};

const allowedPackageManagers = ["auto", "npm", "yarn", "pnpm"];

/**
 * read every action input once, inside run(), so failures surface as proper error annotations
 *
 * Validating here rather than at first use matters: run() deletes the previous pull request comment
 * before any scanning starts, so an input typo that only failed later would leave the pull request
 * with no license report at all.
 * @returns the resolved configuration
 */
const readConfig = (): ActionConfig => {
  const packageManager = (core.getInput("packageManager") || "auto").trim().toLowerCase();
  if (!allowedPackageManagers.includes(packageManager)) {
    throw new Error(`Input "packageManager" must be one of: ${allowedPackageManagers.join(", ")}. Got "${packageManager}".`);
  }

  return {
    blockedLicenses: core.getMultilineInput("blockedLicenses"),
    continueOnBlockedFound: getBooleanInputOrDefault("continueOnBlockedFound", false),
    ignoreFolders: core.getMultilineInput("ignoreFolders"),
    packageManager,
    skipInstall: getBooleanInputOrDefault("skipInstall", false),
    ignoreScripts: getBooleanInputOrDefault("ignoreScripts", false),
  };
};

export { readConfig };
export type { ActionConfig };
