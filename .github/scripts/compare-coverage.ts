import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';

import { warning } from '@actions/core';
import { alphabetical } from 'radashi';
import { z } from 'zod';

import { submitPrBeacon } from '../../src/sdk/index.ts';

// ---------------------------------------------------------------------------
// Schema & types
// ---------------------------------------------------------------------------

const coverageMetricSchema = z.object({
  pct: z.union([z.number(), z.literal('Unknown')]),
});

const summaryJsonSchema = z.record(
  z.string(),
  z.object({
    branches: coverageMetricSchema,
    functions: coverageMetricSchema,
    lines: coverageMetricSchema,
    statements: coverageMetricSchema,
  }),
);

type ProjectCoverage = z.infer<typeof summaryJsonSchema>;
type FileCoverage = ProjectCoverage[string];

const metrics = ['statements', 'branches', 'functions', 'lines'] as const;

// ---------------------------------------------------------------------------
// Helpers extracted from report-coverage pattern
// ---------------------------------------------------------------------------

const PERCENTS_MULTIPLIER = 100;

const normalizePct = (pct: number | 'Unknown'): number => (pct === 'Unknown' ? 0 : pct);

const getDiff = (
  base: number | 'Unknown',
  current: number | 'Unknown',
  { withEmoji = false }: { withEmoji?: boolean } = {},
): string => {
  const diff =
    Math.round(
      (normalizePct(current) - normalizePct(base) + Number.EPSILON) * PERCENTS_MULTIPLIER,
    ) / PERCENTS_MULTIPLIER;

  if (diff < 0) {
    return `(${diff}%${withEmoji ? ' 🔻' : ''})`;
  }
  if (diff > 0) {
    return `(+${diff}%${withEmoji ? ' 🟢' : ''})`;
  }
  return `(±${diff})`;
};

const calculateAvgCoverage = (fileCoverage: FileCoverage): number => {
  const pcts = Object.values(fileCoverage)
    .map(({ pct }) => pct)
    .filter((pct): pct is number => typeof pct === 'number');
  const avg = pcts.reduce((sum, pct) => sum + pct, 0) / pcts.length;
  return Math.round((avg + Number.EPSILON) * PERCENTS_MULTIPLIER) / PERCENTS_MULTIPLIER;
};

const formatMetricCols = (coverage: FileCoverage, baseline: FileCoverage | undefined): string[] =>
  metrics.map((metric) => {
    const current = normalizePct(coverage[metric].pct);
    const base = baseline === undefined ? undefined : normalizePct(baseline[metric].pct);
    const diff = base === undefined ? '' : ` ${getDiff(base, current)}`;
    return `${current}%${diff}`;
  });

const createTable = (
  rows: { file: string; coverage: FileCoverage; baseline: FileCoverage | undefined }[],
  total: { coverage: FileCoverage; baseline: FileCoverage | undefined },
): string => {
  const header = `| File | Stmts | Branch | Funcs | Lines |`;
  const separator = `| :--- | ---: | ---: | ---: | ---: |`;

  const totalAvgCurrent = calculateAvgCoverage(total.coverage);
  const totalAvgBase =
    total.baseline === undefined ? 'Unknown' : calculateAvgCoverage(total.baseline);
  const totalAvgDiff = getDiff(totalAvgBase, totalAvgCurrent, { withEmoji: true });
  const totalCols = formatMetricCols(total.coverage, total.baseline);
  const totalRow = `| **Total** ${totalAvgDiff} | ${totalCols.map((col) => `**${col}**`).join(' | ')} |`;

  const fileRows = rows.map(({ file, coverage, baseline }) => {
    const avgCurrent = calculateAvgCoverage(coverage);
    const avgBase = baseline === undefined ? 'Unknown' : calculateAvgCoverage(baseline);
    const avgDiff = getDiff(avgBase, avgCurrent, { withEmoji: true });
    const cols = formatMetricCols(coverage, baseline);
    return `| \`${file}\` ${avgDiff} | ${cols.join(' | ')} |`;
  });

  return [header, separator, totalRow, ...fileRows].join('\n');
};

// ---------------------------------------------------------------------------
// Load coverage data
// ---------------------------------------------------------------------------

const shortenPath = (filePath: string): string => {
  const cwd = process.cwd();
  return filePath.startsWith(cwd) ? filePath.slice(cwd.length + 1) : filePath;
};

const readCoverage = (path: string): ProjectCoverage | undefined => {
  if (!existsSync(path)) {
    return undefined;
  }
  return summaryJsonSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
};

const prCoverage = readCoverage('coverage/coverage-summary.json');

if (!prCoverage) {
  warning('No PR coverage data found, skipping coverage report');
  // oxlint-disable-next-line unicorn/no-process-exit
  process.exit(0);
}

const baselineCoverage = readCoverage('coverage-baseline/coverage-summary.json');

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

await submitPrBeacon(async (beacon) => {
  const changedFiles = await beacon
    .getChangedFiles()
    .then((files) => files.map(({ filename }) => filename));

  const rows = alphabetical(
    Object.entries(prCoverage).filter(([file]) => file !== 'total'),
    ([file]) => file,
  )
    .map(([absoluteFile, coverage]) => ({
      baseline: baselineCoverage?.[absoluteFile],
      coverage,
      file: shortenPath(absoluteFile),
    }))
    // Show only files whose coverage changed or files touched by this PR
    .filter(({ file, coverage, baseline }) => {
      const avgCurrent = calculateAvgCoverage(coverage);
      const avgBase = baseline === undefined ? undefined : calculateAvgCoverage(baseline);
      return avgBase !== avgCurrent || changedFiles.includes(file);
    });

  const hasBaseline = baselineCoverage !== undefined;
  const heading = hasBaseline
    ? '## Coverage (vs main baseline)'
    : '## Coverage *(no baseline available)*';

  const table = createTable(rows, {
    baseline: baselineCoverage?.total,
    coverage: prCoverage.total,
  });

  beacon.markdown('coverage-report', `${heading}\n\n${table}`);
});
