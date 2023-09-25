import * as core from "@actions/core";
import * as exec from "@actions/exec";
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
    // const continueOnError = core.getBooleanInput("continueOnError");
    // const ignoredPaths = core.getMultilineInput("ignoredPaths");
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
    for (const reviewComment of comments) {

      if (reviewComment?.user?.login !== "github-actions[bot]") {
        return;
      }

      if (!reviewComment?.body?.includes(commentPrefix)) {
        return;
      }

      console.log(`Deleting comment id: ${reviewComment.id})`); // eslint-disable-line no-console
      /*
      await octokit.rest.issues
        .deleteComment({
          ...context.repo,
          comment_id: reviewComment.id, // eslint-disable-line @typescript-eslint/naming-convention
        })
        .catch((error: unknown) => {
          throw new Error(`Unable to delete review comment: ${error as string}`);
        });
        */
    }

    await exec.exec("npm", ["install", "--save-dev", "license-compliance"], {
      silent: true,
    });
    const { stdout: licenseReport } = await exec.getExecOutput(
      "yarn",
      [
        "license-compliance",
        "--production",
        "--format",
        "json",
        "--report",
        "summary",
      ],
      { silent: true },
    );

    const writePullRequestComment = async (comment: string): Promise<void> => {
      await octokit.rest.issues.createComment({
        ...context.repo,
        issue_number: pullRequestNumber, // eslint-disable-line @typescript-eslint/naming-convention
        body: comment,
      })
        .catch((error: unknown) => {
          throw new Error(`Unable to create review comment: ${error as string}`);
        });
    };

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

      prComment += `\n\nCreated by ${commentPrefix}\n`;
      await writePullRequestComment(prComment);
    } else {
      console.error("Unable to extract license report"); // eslint-disable-line no-console
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
