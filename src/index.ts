import * as core from "@actions/core";
import * as github from "@actions/github";
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

    // find all *.csproj folders
    const csprojFolders = await foldersearch.findCsProjectFolders("./", ignoreFolders);

    // process each folder
    for (const folder of csprojFolders) {
      const currentFolder = process.cwd();
      await process.chdir(folder);
      //await npmlicensecheck.processNpm(folder, pullRequestNumber);
      core.info("===> Processing folder: " + folder);
      await process.chdir(currentFolder);
    }
    return;

    // find all package.json folders
    const packageJsonFolders = await foldersearch.findPackageJsonFolders("./", ignoreFolders);

    // process each folder
    for (const folder of packageJsonFolders) {
      const currentFolder = process.cwd();
      await process.chdir(folder);
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

run();
