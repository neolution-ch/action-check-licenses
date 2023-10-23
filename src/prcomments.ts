import * as core from "@actions/core";
import * as github from "@actions/github";

const { context } = github;
const githubToken = core.getInput("GITHUB_TOKEN", { required: true });
const octokit = github.getOctokit(githubToken);

const writePullRequestComment = async (comment: string, pullRequestNumber: number): Promise<void> => {
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

export  {writePullRequestComment }
