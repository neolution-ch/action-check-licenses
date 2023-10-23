import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as github from "@actions/github";
import * as path from "path";
import * as foldersearch from "./foldersearch";
import * as prcomment from "./prcomments";

/**
 * The main entry point
 */
async function run(): Promise<void> {
  try {
    const { context } = github;

    if (!context.payload.pull_request) {
      core.info("===> Not a Pull Request, skipping");
      return;
    }

    const blockedLicenses = core.getMultilineInput("blockedLicenses");
    const continueOnBlockedFound = core.getBooleanInput("continueOnBlockedFound");
    const ignoreFolders = core.getMultilineInput("ignoreFolders");
    const pullRequestNumber = context.payload.pull_request.number;

    await prcomment.removeOldPullRequestComments(pullRequestNumber);

    const processNpm = async (projectPath: string): Promise<void> => {
      core.info(`Starting processNpm for: ${projectPath}`);

      await exec.exec("yarn", [""], {
        silent: true,
      });

      const { stdout: licenseReport } = await exec.getExecOutput(
        "npx",
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

    // install license-compliance
    await exec.exec("yarn", ["global", "add", "license-compliance"], {
      silent: true,
    });

    // find all package.json folders
    const packageJsonFolders = await foldersearch.findPackageJsonFolders("./", ignoreFolders);

    // process each folder
    for (const folder of packageJsonFolders) {
      const fullPath2 = await path.resolve(folder);
      const currentFolder = process.cwd();
      await process.chdir(fullPath2);
      await processNpm(folder);
      await process.chdir(currentFolder);
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error);
    } else {
      core.setFailed(`Unexpected error: ${error as string}`);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
run();
