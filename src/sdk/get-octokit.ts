import { context as githubContext } from '@actions/github';
import { Octokit } from '@octokit/core';
import type { PaginateInterface } from '@octokit/plugin-paginate-rest';
import { paginateRest } from '@octokit/plugin-paginate-rest';

export const getOctokit = ({
  token,
}: {
  token: string;
}): Octokit & { paginate: PaginateInterface } => {
  const OctokitWithPlugins = Octokit.plugin(paginateRest);
  return new OctokitWithPlugins({ auth: token });
};

export const getPrContext = (): {
  issue_number: number;
  owner: string;
  pull_number: number;
  repo: string;
} => ({
  issue_number: githubContext.issue.number,
  owner: githubContext.issue.owner,
  pull_number: githubContext.issue.number,
  repo: githubContext.issue.repo,
});
