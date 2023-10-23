import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as prcomment from "./prcomments";

const blockedLicenses = core.getMultilineInput("blockedLicenses");
const continueOnBlockedFound = core.getBooleanInput("continueOnBlockedFound");

const processNpm = async (projectPath: string, pullRequestNumber: number): Promise<void> => {
  core.info(`Starting processNpm for: ${projectPath}`);

  await exec.exec("yarn", [""], {
    silent: true,
  });

  const { stdout: licenseReport } = await exec.getExecOutput(
    "yarn",
    ["license-compliance", "--production", "--format", "json", "--report", "summary"],
    { silent: true },
  );

  // take valid part of the report
  const regex = /\[[\s\S]*\]/;
  const match = regex.exec(licenseReport);

  // if we found something, process it
  if (match) {
    let prComment = `## NPM License Report: ${projectPath}\n\n`;
    const licenses = JSON.parse(match[0]) as {
      name: string;
      count: number;
    }[];
    licenses.forEach((license: { name: string; count: number }) => {
      core.info(`- License: ${license.name} (${license.count})`); // eslint-disable-line no-console
      prComment += `- ${license.name} (${license.count})\n`;
    });

    const blockedLicenseNames = licenses
      .filter((license) => blockedLicenses.includes(license.name))
      .map((license) => license.name)
      .join(", ");

    if (blockedLicenseNames) {
      prComment += `\n\n:warning: Blocked licenses found: ${blockedLicenseNames}\n`;
    }

    await prcomment.writePullRequestComment(prComment, pullRequestNumber);
    core.info(`Finished processNpm for: ${projectPath}`);

    if (!continueOnBlockedFound && blockedLicenseNames) {
      core.info("Detected not allowed licenses (continueOnBlockedFound = false)");
      throw new Error("Detected not allowed licenses (continueOnBlockedFound = false)");
    }
  } else {
    console.error("Unable to extract license report"); // eslint-disable-line no-console
  }
};

export { processNpm };
