import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as fs from "fs";
import { ActionConfig } from "./config";

let toolInstalled: boolean = false;

interface Package {
  PackageName: string;
  PackageVersion: string;
  PackageUrl: string;
  Copyright: string;
  Authors: string[];
  Description: string;
  LicenseUrl: string;
  LicenseType: string;
  Repository: {
    Type: string;
    Url: string;
    Commit: string;
  };
}

const processNuget = async (csprojFolders: string[], config: ActionConfig): Promise<string> => {
  if (csprojFolders.length === 0) {
    return "";
  }

  if (!toolInstalled) {
    await exec.exec("dotnet", ["tool", "install", "--global", "dotnet-project-licenses"], {
      silent: true,
    });
    toolInstalled = true;
  }

  let prComment = ``;

  for (const projectPath of csprojFolders) {
    core.info(`Starting processNuget for: ${projectPath}`);

    await exec.exec("dotnet-project-licenses", ["-i", `${projectPath}`, "-o", "-j", "--outfile", "dotnetlicenses.json"], { silent: false });

    const licenseReport = fs.readFileSync("dotnetlicenses.json", "utf8");

    // delete file
    fs.unlinkSync("dotnetlicenses.json");

    let prCommentLicenses = "";
    const licenses = JSON.parse(licenseReport) as Package[];

    // sort by name
    licenses.sort((a, b) => a.PackageName.localeCompare(b.PackageName));

    prCommentLicenses += '<ul dir="auto">\n';
    for (const pkg of licenses) {
      prCommentLicenses += `<li>${pkg.PackageName} (${pkg.LicenseType})</li>\n`;
    }
    prCommentLicenses += "</ul>\n";

    // use set to get distinct
    const blockedLicenseNames = [
      ...new Set(licenses.filter((license) => config.blockedLicenses.includes(license.LicenseType)).map((license) => license.LicenseType)),
    ].join(", ");

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
    prComment += "\n\n";

    core.info(`Finished processNuget for: ${projectPath}`);

    if (!config.continueOnBlockedFound && blockedLicenseNames) {
      core.info("Detected not allowed licenses (continueOnBlockedFound = false)");
      throw new Error("Detected not allowed licenses (continueOnBlockedFound = false)");
    }
  }

  return prComment;
};

export { processNuget };
