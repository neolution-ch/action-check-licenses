import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as github from "@actions/github";
import * as path from "path";
import * as foldersearch from "./foldersearch";
import * as prcomment from "./prcomments";
import * as npmlicensecheck from "./npmlicensecheck";

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

    // get config values
    const ignoreFolders = core.getMultilineInput("ignoreFolders");
    const pullRequestNumber = context.payload.pull_request.number;

    // remove old comments
    await prcomment.removeOldPullRequestComments(pullRequestNumber);

    // install license-compliance, required for NPM
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
      await npmlicensecheck.processNpm(folder, pullRequestNumber);
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
