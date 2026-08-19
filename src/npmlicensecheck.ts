import * as core from "@actions/core";
import * as exec from "@actions/exec";
import { ActionConfig } from "./config";
import { buildInstallPlan, detectPackageManager, preparePackageManager } from "./packagemanager";

interface PackageEntry {
  name: string;
  license: string;
  repository: string;
  version: string;
}

/**
 * escape text that ends up inside the HTML of the pull request comment
 * @param value the untrusted text
 * @returns the escaped text
 */
const escapeHtml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

/**
 * remove credentials from any URL in tool output before it is published
 *
 * The failure most likely to be reported here is a registry rejecting an unauthenticated request,
 * and registry error lines routinely echo the URL that was called -- userinfo included.
 * @param value the raw tool output
 * @returns the output with any URL userinfo replaced
 */
const scrubCredentials = (value: string): string => value.replaceAll(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, "$1***@");

/**
 * render a collapsed report block for a folder that could not be scanned
 * @param projectPath the folder that was skipped
 * @param headline the reason shown in the summary line
 * @param detail the underlying error output
 * @returns markdown for the pull request comment
 */
const skippedComment = (projectPath: string, headline: string, detail: string): string => {
  const safeDetail = escapeHtml(scrubCredentials(detail).slice(0, 1000));
  core.warning(`${projectPath}: ${headline} - ${scrubCredentials(detail)}`);
  return [
    "<details>",
    `<summary>:grey_question: <b>${escapeHtml(projectPath)}</b>: not scanned (${escapeHtml(headline)})</summary>`,
    '<ul dir="auto">',
    `<li>${safeDetail}</li>`,
    "</ul>",
    "</details>",
  ].join("\n");
};

/**
 * parse a JSON array out of tool output that may carry log noise around it
 * @param output the raw stdout
 * @returns the parsed array, or undefined if nothing usable was found
 */
const parseJsonArray = <T>(output: string): T[] | undefined => {
  const trimmed = output.trim();
  if (!trimmed) {
    return [];
  }

  // license-compliance prints warnings on stdout for packages it cannot resolve, so the JSON is not
  // always the whole of it. Take the outermost balanced bracket pair rather than a greedy match.
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start === -1 || end < start) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * install the folder's dependencies with whichever package manager it actually uses
 *
 * Returns an error description instead of throwing: one folder that cannot be installed (a private
 * registry without credentials, a manager missing from the runner) must not discard the license
 * report for every other project in the repository.
 * @param projectPath the folder to install
 * @param config the resolved action configuration
 * @returns undefined on success, or a human readable reason for the failure
 */
const installDependencies = async (projectPath: string, config: ActionConfig): Promise<string | undefined> => {
  const info = detectPackageManager(projectPath, { override: config.packageManager });
  const detected = `${info.name}${info.berry ? " (berry)" : ""} - ${info.reason}`;

  if (info.reason.startsWith("no lockfile")) {
    // The riskiest branch: without a lockfile the install resolves whatever is current, so the
    // report can describe a dependency set the project does not actually ship.
    core.warning(`Package manager for ${projectPath}: ${detected}`);
  } else {
    core.info(`Package manager for ${projectPath}: ${detected}`);
  }

  if (info.name === "bun") {
    return "bun is not supported; set the packageManager input to override detection";
  }

  const prepared = await preparePackageManager(info, projectPath);
  if (prepared.error) {
    return prepared.error;
  }

  const plan = buildInstallPlan(prepared.info, config.ignoreScripts);

  const { exitCode, stdout, stderr } = await exec.getExecOutput(plan.command, plan.args, {
    cwd: projectPath,
    env: { ...process.env, ...plan.env } as Record<string, string>,
    ignoreReturnCode: true,
    silent: true,
  });

  if (exitCode !== 0) {
    // The whole output goes to the run log; only a short tail goes into the pull request comment.
    // Managers do not agree on which stream carries the diagnosis, so both are kept.
    const combined = `${stdout}\n${stderr}`.trim();
    core.info(`--- ${plan.command} output for ${projectPath} ---\n${scrubCredentials(combined)}`);
    const reason = combined.split("\n").filter(Boolean).slice(-8).join(" ").trim();
    return `${plan.command} ${plan.args.join(" ")} exited with code ${exitCode}${reason ? `: ${reason}` : ""}`;
  }

  return undefined;
};

/**
 * run the license scanner over an installed folder
 * @param projectPath the folder to scan
 * @param report which license-compliance report to produce
 * @returns the parsed rows, or a reason the scan could not be used
 */
const runScanner = async <T>(projectPath: string, report: "detailed" | "summary"): Promise<{ rows?: T[]; failure?: string }> => {
  const { exitCode, stdout, stderr } = await exec.getExecOutput(
    "npx",
    ["--yes", "license-compliance@2", "--production", "--format", "json", "--report", report],
    { cwd: projectPath, ignoreReturnCode: true, silent: true },
  );

  if (exitCode !== 0) {
    const combined = `${stdout}\n${stderr}`.trim();
    core.info(`--- license-compliance (${report}) output for ${projectPath} ---\n${scrubCredentials(combined)}`);
    const reason = combined.split("\n").filter(Boolean).slice(-8).join(" ").trim();
    return { failure: `license-compliance --report ${report} exited with code ${exitCode}${reason ? `: ${reason}` : ""}` };
  }

  const rows = parseJsonArray<T>(stdout);
  if (!rows) {
    core.info(`--- license-compliance (${report}) output for ${projectPath} ---\n${stdout}`);
    return { failure: `could not parse the ${report} license report; see the run log for the raw output` };
  }

  return { rows };
};

/**
 * scan one folder's production dependencies and render its section of the report
 * @param projectPath the folder to scan
 * @param config the resolved action configuration
 * @returns markdown for the pull request comment
 */
const processNpm = async (projectPath: string, config: ActionConfig): Promise<string> => {
  core.info(`Starting processNpm for: ${projectPath}`);

  if (config.skipInstall) {
    core.info(`Skipping install for ${projectPath} (skipInstall = true)`);
  } else {
    const failure = await installDependencies(projectPath, config);
    if (failure) {
      return skippedComment(projectPath, "dependency install failed", failure);
    }
  }

  // create detailed report
  const detailed = await runScanner<PackageEntry>(projectPath, "detailed");
  if (detailed.failure) {
    return skippedComment(projectPath, "license scan failed", detailed.failure);
  }

  const tableData = (detailed.rows ?? []).map(({ name, version, license, repository }) => {
    const status = config.blockedLicenses.includes(license) ? ":warning:" : ":white_check_mark:";
    return [status, name, version, license, repository];
  });

  await core.summary
    .addHeading(`NPM license Details for ${projectPath}`)
    .addTable([
      [
        { data: "Status", header: true },
        { data: "Name", header: true },
        { data: "Version", header: true },
        { data: "License", header: true },
        { data: "Repository", header: true },
      ],
      ...tableData,
    ])
    .write();

  // create summary report for PR comment
  const summary = await runScanner<{ name: string; count: number }>(projectPath, "summary");
  if (summary.failure) {
    return skippedComment(projectPath, "license scan failed", summary.failure);
  }

  const licenses = summary.rows ?? [];
  if (licenses.length === 0) {
    // An empty result is not the same as a clean one: it usually means nothing was installed.
    return skippedComment(projectPath, "no packages found", "the scan returned no production dependencies");
  }

  let prComment = ``;
  let prCommentLicenses = "";

  prCommentLicenses += '<ul dir="auto">\n';
  for (const license of licenses) {
    core.info(`- License: ${license.name} (${license.count})`);
    prCommentLicenses += `<li>${escapeHtml(license.name)} (${license.count})</li>\n`;
  }
  prCommentLicenses += "</ul>\n";

  const blockedLicenseNames = licenses
    .filter((license) => config.blockedLicenses.includes(license.name))
    .map((license) => license.name)
    .join(", ");

  if (blockedLicenseNames) {
    prComment += "<details open>\n";
    prComment += `<summary>:warning: <b>${escapeHtml(projectPath)}</b>: Blocked licenses found: ${escapeHtml(blockedLicenseNames)}</summary>\n`;
    prComment += prCommentLicenses;
    prComment += "</details>";
  } else {
    prComment += "<details>\n";
    prComment += `<summary>:white_check_mark: <b>${escapeHtml(projectPath)}</b>: No problematic licenses found</summary>\n`;
    prComment += prCommentLicenses;
    prComment += "</details>";
  }

  core.info(`Finished processNpm for: ${projectPath}`);

  if (!config.continueOnBlockedFound && blockedLicenseNames) {
    core.info("Detected not allowed licenses (continueOnBlockedFound = false)");
    throw new Error("Detected not allowed licenses (continueOnBlockedFound = false)");
  }

  return prComment;
};

export { processNpm };
