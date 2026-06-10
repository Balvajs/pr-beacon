import process from 'node:process';

import { info, setFailed } from '@actions/core';
import { context as githubContext } from '@actions/github';
import type { operations } from '@octokit/openapi-types';
import { marked } from 'marked';
import picocolors from 'picocolors';
import { shake } from 'radashi';

import { renderBeacon } from './beacon-document.ts';
import type {
  MarkdownMessage,
  ReplaceMode,
  TableRowMessage,
  TableType,
} from './beacon-document.ts';
import { commentPr } from './comment-pr.ts';
import { getOctokit, getPrContext } from './get-octokit.ts';

type PrInfo = Awaited<ReturnType<PrBeacon['_fetchPrInfo']>>['data'];
type Octokit = ReturnType<typeof getOctokit>;

/**
 * Default content ID derived from the current workflow and job names.
 * Used to scope beacon content to the job that produced it, enabling
 * targeted upserts across multiple CI jobs.
 */
const getDefaultContentId = (): string => `${githubContext.workflow}/${githubContext.job}`;

const convertMarkdownToHtml = (message: string): string =>
  marked.parse(message, {
    async: false,
    breaks: true,
    gfm: true,
  });

type TableRowOptions = Omit<TableRowMessage, 'message'> & {
  id?: string;
  markdownToHtml?: boolean;
};

/**
 * Loggers keyed by table type, called at accumulation time so each row is
 * logged exactly once regardless of how many times the beacon body is
 * re-rendered (e.g. on concurrent-write retries).
 */
const rowLoggers: Record<TableType, (message: string, icon: string | undefined) => void> = {
  fails: (message) => {
    info(picocolors.red(`${picocolors.bold('🚫 FAIL')}: ${message}\n\n`));
  },
  messages: (message, icon) => {
    info(`${icon ?? '📖'} ${message}\n\n`);
  },
  warnings: (message) => {
    info(picocolors.yellow(`${picocolors.bold('⚠️ WARNING')}: ${message}\n\n`));
  },
};

/**
 * PR beacon is sticky comment in PR, that has 2 main sections: tables and markdowns
 *
 * Tables are always in the top of the report, and there are 3 table types: fails, warning, messages
 * Having at least 1 record in `fails` table causes the action to throw error after submit
 *
 * Markdowns are always in the bottom of the report, and these are basically markdown sections without any limitations
 *
 * Changes to PR beacon are accumulated from calls of `fail`, `warn`, `message` and `markdown` function
 * and then submitted with `submit` function.
 *
 * `submit` function creates/updates sticky PR beacon and can be called from multiple jobs in CI
 * each call will always update only relevant type of PR beacon content
 */
export class PrBeacon {
  private readonly tables: Record<TableType, TableRowMessage[]> = {
    fails: [],
    messages: [],
    warnings: [],
  };

  private readonly markdowns: MarkdownMessage[] = [];

  private readonly githubToken: string;
  private readonly octokit: Octokit;
  private readonly prContext = getPrContext();
  private prInfoCache: PrInfo | undefined;

  constructor({
    githubToken,
  }: {
    /**
     * GitHub token with `issues: write` and `pull-requests: write` scope, used for authentication when calling GitHub API
     *
     * @default process.env.GITHUB_TOKEN
     */
    githubToken?: string;
  } = {}) {
    const token = githubToken ?? process.env.GITHUB_TOKEN;

    if (token === undefined || token === '') {
      throw new Error(
        'GitHub token is not provided. Please provide it as `githubToken` parameter or set it in `GITHUB_TOKEN` environment variable.',
      );
    }

    this.githubToken = token;
    this.octokit = getOctokit({ token: this.githubToken });
  }

  // oxlint-disable-next-line typescript/explicit-function-return-type
  private readonly _fetchPrInfo = async () =>
    this.octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', this.prContext);

  getPrInfo = async (): Promise<PrInfo> => {
    if (!this.prInfoCache) {
      const result = await this._fetchPrInfo();
      this.prInfoCache = result.data;
    }

    return this.prInfoCache;
  };

  /**
   * Helper function to get list of changed files in PR
   */
  getChangedFiles = async (): Promise<
    operations['pulls/list-files']['responses']['200']['content']['application/json']
  > =>
    this.octokit.paginate('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
      ...this.prContext,
      per_page: 100,
    });

  private addTableRow(
    tableType: TableType,
    message: string,
    { markdownToHtml, ...meta }: TableRowOptions,
  ): void {
    rowLoggers[tableType](message, meta.icon);

    this.tables[tableType].push({
      id: getDefaultContentId(),
      message: markdownToHtml === true ? convertMarkdownToHtml(message) : message,
      ...shake(meta, (value) => value === undefined || value === ''),
    });
  }

  /**
   * Add fail message to the `Fails` beacon section
   */
  fail(message: string, options: TableRowOptions = {}): void {
    this.addTableRow('fails', message, options);
  }

  /**
   * Add warning message to the `Warnings` table in the PR beacon
   */
  warn(message: string, options: TableRowOptions = {}): void {
    this.addTableRow('warnings', message, options);
  }

  /**
   * Add message to the `Messages` table in the PR beacon
   */
  message(message: string, options: TableRowOptions = {}): void {
    this.addTableRow('messages', message, options);
  }

  /**
   * Append markdown to the free format section under all tables in the PR beacon
   */
  markdown(message: string, meta: { id?: string } = {}): void {
    this.markdowns.push({
      id: getDefaultContentId(),
      message,
      ...shake(meta, (value) => value === undefined || value === ''),
    });
  }

  private static _buildFooter(): string {
    const humanReadableTime = new Date().toLocaleString('cs-CZ', {
      timeZone: 'Europe/Prague',
      timeZoneName: 'shortOffset',
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const headSha = (githubContext.payload.pull_request?.head as { sha: string } | undefined)?.sha;

    return `Generated <code>${humanReadableTime}</code> for ${headSha}`;
  }

  /**
   * Returns true if `prBeacon.fail()` was called before
   */
  hasFails(): boolean {
    return this.tables.fails.length > 0;
  }

  /**
   * Submit content accumulated from `fail`, `warn`, `message` and `markdown` functions and update PR beacon.
   * Is not meant to be called directly, but rather through `runPrBeacon` function
   */
  async _submit(
    options: {
      /**
       * IDs of content (both table rows and markdowns) that should be removed before new content is added
       *
       * Usually used in subsequent CI jobs, that are meant only for appending data to existing report
       *
       * @default [`${workflow}/${job}`] — the current workflow + job name combination
       */
      contentIdsToUpdate?: string[];
      /**
       * If true, the CI step will fail when there is at least one message in `Fails` table.
       */
      shouldFailOnFailMessage?: boolean;
      /**
       * Controls how updated table rows are positioned relative to existing rows.
       *
       * - `'in-place'` (default): New rows replace at the position of the first old row with the same ID, preserving ordering.
       * - `'append'`: Old rows are removed and new rows are appended at the end of the table.
       */
      replaceMode?: ReplaceMode;
    } = {},
  ): Promise<ReturnType<typeof commentPr>> {
    const { contentIdsToUpdate = [getDefaultContentId()], replaceMode } = options;

    const updateReport = (oldBeacon: string | undefined): string =>
      renderBeacon({
        contentIdsToUpdate,
        footer: PrBeacon._buildFooter(),
        newMarkdowns: this.markdowns,
        newTables: this.tables,
        previousBody: oldBeacon,
        replaceMode,
      });

    const commentResult = await commentPr({
      commentId: 'PR-BEACON',
      githubToken: this.githubToken,
      markdown: updateReport,
    });

    if (this.hasFails() && options.shouldFailOnFailMessage === true) {
      setFailed(`Check failed with ${this.tables.fails.length} errors!`);
    }

    return commentResult;
  }
}
