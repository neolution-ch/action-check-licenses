import * as core from "@actions/core";
import * as github from "@actions/github";
import * as foldersearch from "./foldersearch";
import * as prcomment from "./prcomments";
import * as npmlicensecheck from "./npmlicensecheck";
import * as nugetlicensecheck from "./nugetlicensecheck";

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
    const csprojFolders = foldersearch.findCsProjectFolders("./", ignoreFolders);

    // process each folder
    let textForComment = await nugetlicensecheck.processNuget(csprojFolders);

    // find all package.json folders
    const packageJsonFolders = foldersearch.findPackageJsonFolders("./", ignoreFolders, true);

    // process each folder
    for (const folder of packageJsonFolders) {
      const currentFolder = process.cwd();
      process.chdir(folder);
      textForComment += await npmlicensecheck.processNpm(folder);
      process.chdir(currentFolder);
    }

    // create comment
    let prComment = `## License Report\n\n`;
    prComment += textForComment;
    await prcomment.writePullRequestComment(prComment, pullRequestNumber);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error);
    } else {
      core.setFailed(`Unexpected error: ${error as string}`);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises, unicorn/prefer-top-level-await
run();
