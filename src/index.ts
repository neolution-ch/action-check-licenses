import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as github from "@actions/github";

const commentPrefix = "[action-check-licenses]";
const fs = require('fs');
const path = require('path');

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

    const githubToken = core.getInput("GITHUB_TOKEN", { required: true });
    const blockedLicenses = core.getMultilineInput("blockedLicenses");
    const continueOnBlockedFound = core.getBooleanInput("continueOnBlockedFound");
    const pullRequestNumber = context.payload.pull_request.number;

    const octokit = github.getOctokit(githubToken);

    const { data: comments } = await octokit.rest.issues
      .listComments({
        ...context.repo,
        issue_number: pullRequestNumber, // eslint-disable-line @typescript-eslint/naming-convention
      })
      .catch((error: unknown) => {
        throw new Error(`Unable to get review comments: ${error as string}`);
      });

    // Delete existing comments
    for (const comment of comments) {
      if (comment.user?.login !== "github-actions[bot]") {
        return;
      }

      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (comment.body?.includes(commentPrefix)) {
        console.log(`Deleting comment id: ${comment.id}`); // eslint-disable-line no-console

        await octokit.rest.issues
          .deleteComment({
            ...context.repo,
            comment_id: comment.id, // eslint-disable-line @typescript-eslint/naming-convention
          })
          .catch((error: unknown) => {
            throw new Error(`Unable to delete review comment: ${error as string}`);
          });
      }
    }

    const writePullRequestComment = async (comment: string): Promise<void> => {
      await octokit.rest.issues
        .createComment({
          ...context.repo,
          issue_number: pullRequestNumber, // eslint-disable-line @typescript-eslint/naming-convention
          body: comment,
        })
        .catch((error: unknown) => {
          throw new Error(`Unable to create review comment: ${error as string}`);
        });
    };

    const processNpm = async (projectPath: string): Promise<void> => {
      core.info(`processNpm for: ${projectPath}`);

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

        prComment += `\n\n<sub>Created by: ${commentPrefix}</sub>\n`;

        await writePullRequestComment(prComment);
        core.info(`npm process done for: ${projectPath}`);

        if (!continueOnBlockedFound && blockedLicenseNames) {
          core.info(`Detected not allowed licenses (continueOnBlockedFound = false)`);
          throw new Error("Detected not allowed licenses (continueOnBlockedFound = false)");
        }
      } else {
        console.error("Unable to extract license report"); // eslint-disable-line no-console
      }
    };

    const findPackageJsonFolders = async (currentPath: string): Promise<void> => {
      const dirents = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const dirent of dirents) {
          const fullPath = path.join(currentPath, dirent.name);
          if (dirent.isDirectory()) {
            if (fullPath.includes('node_modules') || dirent.name.startsWith('.')) {
              continue;
          }

              let packageJsonPath = path.join(fullPath, 'package.json');
              packageJsonPath = await path.resolve(packageJsonPath);

              try {
                  fs.accessSync(packageJsonPath);
              } catch (error) {
                  // package.json does not exist in the directory
                  continue;
              }

              core.info(`package.json found: ${fullPath}`);
              const fullPath2 = await path.resolve(fullPath);
              const currentFolder = process.cwd()
              await process.chdir(fullPath2);
              await processNpm(fullPath);
              await process.chdir(currentFolder);
          }
      }
    }

    // https://github.com/actions/runner-images/issues/599
    await exec.exec("yarn", ["global", "add", "license-compliance"], {
      silent: true,
    });

    await findPackageJsonFolders('./');



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
