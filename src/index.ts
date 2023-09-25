import * as core from "@actions/core";
import * as exec from "@actions/exec";ex
import * as github from "@actions/github";

const commentPrefix = "[action-check-licenses]";

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
    const continueOnError = core.getBooleanInput("continueOnError");
    const ignoredPaths = core.getMultilineInput("ignoredPaths");
    const pullRequestNumber = context.payload.pull_request.number;

    const octokit = github.getOctokit(githubToken);

    const { data: reviewComments } = await octokit.rest.pulls.listReviewComments({
      ...context.repo,
      pull_number: pullRequestNumber, // eslint-disable-line @typescript-eslint/naming-convention
    }).catch((error: unknown) => {
      throw new Error(`Unable to get review comments: ${error as string}`);
    });

    // Delete existing comments
    for (const reviewComment of reviewComments) {
      if (reviewComment.user.login !== "github-actions[bot]") {
        return;
      }

      if (!reviewComment.body.includes(commentPrefix)) {
        return;
      }

      await octokit.rest.pulls.deleteReviewComment({
        ...context.repo,
        comment_id: reviewComment.id, // eslint-disable-line @typescript-eslint/naming-convention
      }).catch((error: unknown) => {
        throw new Error(`Unable to delete review comment: ${error as string}`);
      });
    }

    await exec.exec("npm", ["install", "--save-dev", "license-compliance"]);

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
