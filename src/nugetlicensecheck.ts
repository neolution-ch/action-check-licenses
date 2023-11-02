import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as prcomment from "./prcomments";
import * as fs from "fs";

const blockedLicenses = core.getMultilineInput("blockedLicenses");
const continueOnBlockedFound = core.getBooleanInput("continueOnBlockedFound");
let toolInstalled: boolean = false;

const processNuget = async (projectPath: string, pullRequestNumber: number): Promise<void> => {
  core.info(`Starting processNuget for: ${projectPath}`);

  if (!toolInstalled) {
    await exec.exec("dotnet", ["tool", "install", "--global", "dotnet-project-licenses"], {
      silent: true,
    });
    toolInstalled = true;
  }

  await exec.exec("dotnet-project-licenses", ["-i", `${projectPath}`, "-o", "-j", "--outfile", "dotnetlicenses.json"], { silent: false });

  const licenseReport = fs.readFileSync("dotnetlicenses.json", 'utf8');

  // delete file
  fs.unlinkSync("dotnetlicenses.json");

  core.info(`licenseReport: ${licenseReport}`);

  return;

  // if we found something, process it
  if (true) {
    let prComment = `## Nuget License Report: ${projectPath}\n\n`;
    let prCommentLicenses = "";
    const licenses = JSON.parse(licenseReport) as {
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
      prComment += `<summary>:warning: Blocked licenses found: ${blockedLicenseNames}</summary>\n`;
      prComment += prCommentLicenses;
      prComment += "</details>";
    } else {
      prComment += "<details>\n";
      prComment += "<summary>:white_check_mark: No problematic licenses found</summary>\n";
      prComment += prCommentLicenses;
      prComment += "</details>";
    }

    await prcomment.writePullRequestComment(prComment, pullRequestNumber);
    core.info(`Finished processNuget for: ${projectPath}`);

    if (!continueOnBlockedFound && blockedLicenseNames) {
      core.info("Detected not allowed licenses (continueOnBlockedFound = false)");
      throw new Error("Detected not allowed licenses (continueOnBlockedFound = false)");
    }
  } else {
    core.error("Unable to extract license report");
  }
};

export { processNuget };
