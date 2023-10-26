import * as core from "@actions/core";
import * as github from "@actions/github";

const commentPrefix = "[action-check-licenses]";
const { context } = github;
const githubToken = core.getInput("GITHUB_TOKEN", { required: true });
const octokit = github.getOctokit(githubToken);

const writePullRequestComment = async (comment: string, pullRequestNumber: number): Promise<void> => {
  // append footer note
  const finalcomment = `${comment}\n\n<sub>Created by: ${commentPrefix}</sub>\n`;

  await octokit.rest.issues
    .createComment({
      ...context.repo,
      issue_number: pullRequestNumber, // eslint-disable-line @typescript-eslint/naming-convention
      body: finalcomment,
    })
    .catch((error: unknown) => {
      throw new Error(`Unable to create review comment: ${error as string}`);
    });
};

const removeOldPullRequestComments = async (pullRequestNumber: number): Promise<void> => {
  const { data: comments } = await octokit.rest.issues
    .listComments({
      ...context.repo,
      issue_number: pullRequestNumber,
    })
    .catch((error: unknown) => {
      core.error(`Unable to get review comments: ${error as string}`);
      throw new Error(`Unable to get review comments: ${error as string}`);
    });

  // Delete existing comments
  for (const comment of comments) {
    core.info(`Verifying comment ${comment.id}: ${comment.user?.login}`);

    if (comment.user?.login !== "github-actions[bot]") {
      core.info(`Skipping comment id: ${comment.id} because it was not created by the bot`);
      return;
    }

    if (comment.body?.includes(commentPrefix)) {
      console.log(`Deleting comment id: ${comment.id}`);

      await octokit.rest.issues
        .deleteComment({
          ...context.repo,
          comment_id: comment.id,
        })
        .catch((error: unknown) => {
          throw new Error(`Unable to delete review comment: ${error as string}`);
        });
    }
  }
};

export { writePullRequestComment, removeOldPullRequestComments };
