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

    const processNpm = async (): Promise<void> => {

      await exec.exec("npm", ["install", "--save-dev", "license-compliance"], {
        silent: false,
      });

      const { stdout: licenseReport } = await exec.getExecOutput(
        "yarn",
        ["license-compliance", "--production", "--format", "json", "--report", "summary"],
        { silent: false },
      );

      // take valid part of the report
      const regex = /\[[\s\S]*\]/;
      const match = regex.exec(licenseReport);

      // if we found something, process it
      if (match) {
        let prComment = "## NPM License Report\n\n";
        const licenses = JSON.parse(match[0]) as {
          name: string;
          count: number;
        }[];
        licenses.forEach((license: { name: string; count: number }) => {
          console.log(`License: ${license.name} (${license.count})`); // eslint-disable-line no-console
          prComment += `- ${license.name} (${license.count})\n`;
        });

        const blockedLicenseNames = licenses
          .filter((license) => blockedLicenses.includes(license.name))
          .map((license) => license.name)
          .join(", ");

        if (blockedLicenseNames) {
          prComment += `\n\n:warning: Blocked licenses found: ${blockedLicenseNames}\n`;
        }

        prComment += `\n\nCreated by ${commentPrefix}\n`;
        await writePullRequestComment(prComment);

        if (!continueOnBlockedFound && blockedLicenseNames) {
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

              const packageJsonPath = path.join(fullPath, 'package.json');
              try {
                  await fs.access(packageJsonPath);
                  console.log(packageJsonPath);

                  const fullPath2 = path.resolve(fullPath);
                  core.info(`Found package.json in: ${fullPath2}`);
                  await process.chdir(fullPath);
                  core.info("changedir was ok");
                  await processNpm();
                  //console.log(`Changed directory to: ${process.cwd()}`);
              } catch (error) {
                  // package.json does not exist in the directory
              }
              //await findPackageJsonFolders(fullPath);
          }
      }
    }

    findPackageJsonFolders('./').catch(console.error);



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
