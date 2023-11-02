import * as core from "@actions/core";
import * as exec from "@actions/exec";

const blockedLicenses = core.getMultilineInput("blockedLicenses");
const continueOnBlockedFound = core.getBooleanInput("continueOnBlockedFound");

const processNpm = async (projectPath: string): Promise<string> => {
  core.info(`Starting processNpm for: ${projectPath}`);

  await exec.exec("yarn", [""], {
    silent: true,
  });

  const { stdout: licenseReport } = await exec.getExecOutput(
    "npx",
    ["license-compliance@2", "--production", "--format", "json", "--report", "summary"],
    { silent: true },
  );

  // take valid part of the report
  const regex = /\[[\s\S]*\]/;
  const match = regex.exec(licenseReport);

  // if we found something, process it
  if (match) {
    let prComment = ``;
    let prCommentLicenses = "";
    const licenses = JSON.parse(match[0]) as {
      name: string;
      count: number;
    }[];

    prCommentLicenses += '<ul dir="auto">\n';
    licenses.forEach((license: { name: string; count: number }) => {
      core.info(`- License: ${license.name} (${license.count})`);
      prCommentLicenses += `<li>${license.name} (${license.count})</li>\n`;
    });
    prCommentLicenses += "</ul>\n";

    const blockedLicenseNames = licenses
      .filter((license) => blockedLicenses.includes(license.name))
      .map((license) => license.name)
      .join(", ");

    if (blockedLicenseNames) {
      prComment += "<details open>\n";
      prComment += `<summary>:warning: <b>${projectPath}</b>: Blocked licenses found: ${blockedLicenseNames}</summary>\n`;
      prComment += prCommentLicenses;
      prComment += "</details>";
    } else {
      prComment += "<details>\n";
      prComment += `<summary>:white_check_mark: <b>${projectPath}</b>: No problematic licenses found</summary>\n`;
      prComment += prCommentLicenses;
      prComment += "</details>";
    }

    core.info(`Finished processNpm for: ${projectPath}`);

    if (!continueOnBlockedFound && blockedLicenseNames) {
      core.info("Detected not allowed licenses (continueOnBlockedFound = false)");
      throw new Error("Detected not allowed licenses (continueOnBlockedFound = false)");
    }

    return prComment;
  } else {
    core.error("Unable to extract license report");
    return `${projectPath} Unable to extract license report`;
  }
};

export { processNpm };
