# PR Beacon 🗼

[![npm](https://img.shields.io/npm/v/@balvajs/pr-beacon)](https://www.npmjs.com/package/@balvajs/pr-beacon)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> A [Danger.js](https://danger.systems/js/)-inspired GitHub Action that maintains a single sticky PR comment consolidating CI failures, warnings, and messages from across all your workflow jobs.

---

## Overview

PR Beacon solves the noise problem in pull request CI feedback. Instead of each job posting its own comment — leaving a cluttered thread — every job contributes to **one persistent beacon comment** that is created on first run and updated in place on every subsequent run.

The beacon is structured into two main areas:

- **Tables** — Three severity levels displayed as structured HTML tables at the top of the comment:
  | Section | Default Icon | Meaning |
  |---|---|---|
  | Fails | 🚫 | Blocking issues that must be resolved |
  | Warnings | ⚠️ | Non-blocking issues worth attention |
  | Messages | 📖 | Informational notes |

- **Markdowns** — Free-form markdown sections appended below the tables.

Each job owns its content slice via a **content ID** (defaulting to `workflow/job`). On every run a job replaces only its own slice, leaving other jobs' content untouched. Concurrent writes from parallel jobs are handled with optimistic locking and automatic retries.

---

## Features

- **Sticky comment** — one comment per PR, updated in place, never duplicated
- **Multi-job safe** — parallel CI jobs can all write without clobbering each other
- **Upsert semantics** — each job replaces only its own previously written content
- **Markdown support** — render markdown inside table cells or in free-form sections
- **Custom icons** — override the default icon per row
- **JSON file input** — pass a structured payload file for complex multi-row updates
- **SDK** — use the `@balvajs/pr-beacon` NPM package directly in your own scripts

---

## GitHub Action Usage

### Minimal — single message

```yaml
- uses: Balvajs/pr-beacon@1248b5b89c25f915cc9e65b8dcc99c2e7be8f973 # v1.0.0
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    message: Build completed successfully.
```

### Report a failure

```yaml
- uses: Balvajs/pr-beacon@1248b5b89c25f915cc9e65b8dcc99c2e7be8f973 # v1.0.0
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    fail: Tests failed on Node 22. See the [logs](${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}).
```

### Report a warning

```yaml
- uses: Balvajs/pr-beacon@1248b5b89c25f915cc9e65b8dcc99c2e7be8f973 # v1.0.0
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    warn: Bundle size increased by 12 kB.
    warn-icon: 📦
```

### Multi-row payload via JSON file

For complex scenarios — multiple rows, mixed severity levels, or markdown sections — write the payload to a JSON file and point the action at it.

**`beacon-payload.json`**

```json
{
  "fails": [{ "message": "Coverage dropped below 80%.", "id": "coverage-check" }],
  "warnings": [
    "Dependency `lodash` has a known vulnerability.",
    { "message": "Build took **4 m 12 s** — consider caching.", "icon": "🐢" }
  ],
  "messages": ["Deployed preview to https://preview.example.com"],
  "markdowns": [
    {
      "id": "coverage-report",
      "message": "## Coverage\n\n| File | % |\n|---|---|\n| index.ts | 94% |\n| utils.ts | 78% |"
    }
  ]
}
```

```yaml
- name: Generate payload
  run: node scripts/generate-beacon-payload.js > beacon-payload.json

- uses: Balvajs/pr-beacon@1248b5b89c25f915cc9e65b8dcc99c2e7be8f973 # v1.0.0
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    json-file: beacon-payload.json
```

### Multi-job workflow

Each job writes to its own content slice. The beacon accumulates content from all jobs.

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
        continue-on-error: true
      - uses: Balvajs/pr-beacon@1248b5b89c25f915cc9e65b8dcc99c2e7be8f973 # v1.0.0
        if: always()
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          fail: Unit tests failed. # written under ID "{workflow} / {job}"

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run lint
        continue-on-error: true
      - uses: Balvajs/pr-beacon@1248b5b89c25f915cc9e65b8dcc99c2e7be8f973 # v1.0.0
        if: always()
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          warn: Lint warnings detected. # written under ID "{workflow} / {job}"
```

### Post a markdown section

```yaml
- uses: Balvajs/pr-beacon@1248b5b89c25f915cc9e65b8dcc99c2e7be8f973 # v1.0.0
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    markdown-id: coverage-report
    markdown: |
      ## Coverage

      | File | % |
      |---|---|
      | index.ts | 94% |
      | utils.ts | 78% |
```

### Targeted update — replace content from a previous job

Use `content-ids-to-update` to remove content written by a specific earlier job before adding new content. This is useful in retry or follow-up jobs.

```yaml
- uses: Balvajs/pr-beacon@1248b5b89c25f915cc9e65b8dcc99c2e7be8f973 # v1.0.0
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    content-ids-to-update: 'CI / build'
    message: Build retried and passed.
```

---

## Inputs

| Input                   | Required | Default   | Description                                                                                                              |
| ----------------------- | -------- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| `token`                 | **Yes**  | —         | GitHub token (`GITHUB_TOKEN`) used to post PR comments. Requires `issues: write` and `pull-requests: write` permissions. |
| `json-file`             | No       | `''`      | Path to a JSON file defining the full beacon payload (see [schema](#json-file-schema)).                                  |
| `fail`                  | No       | `''`      | A single failure message added to the Fails table. Supports markdown.                                                    |
| `fail-icon`             | No       | `''`      | Custom icon for the `fail` entry (e.g. `💥`).                                                                            |
| `fail-id`               | No       | `''`      | Content ID for the `fail` entry, used for targeted upsert.                                                               |
| `warn`                  | No       | `''`      | A single warning message added to the Warnings table. Supports markdown.                                                 |
| `warn-icon`             | No       | `''`      | Custom icon for the `warn` entry.                                                                                        |
| `warn-id`               | No       | `''`      | Content ID for the `warn` entry, used for targeted upsert.                                                               |
| `message`               | No       | `''`      | A single informational message added to the Messages table. Supports markdown.                                           |
| `message-icon`          | No       | `''`      | Custom icon for the `message` entry.                                                                                     |
| `message-id`            | No       | `''`      | Content ID for the `message` entry, used for targeted upsert.                                                            |
| `markdown`              | No       | `''`      | A single free-form markdown block appended below the tables.                                                             |
| `markdown-id`           | No       | `''`      | Content ID for the `markdown` entry, used for targeted upsert.                                                           |
| `content-ids-to-update` | No       | `''`      | Comma-separated list of content IDs to remove before adding new content.                                                 |
| `fail-on-fail-message`  | No       | `'false'` | When `'true'`, the action step exits with a non-zero code if any fail message is present.                                |

### JSON file schema

```json
{
  "fails":    [ "string" | { "message": "string", "icon?": "string", "id?": "string" } ],
  "warnings": [ "string" | { "message": "string", "icon?": "string", "id?": "string" } ],
  "messages": [ "string" | { "message": "string", "icon?": "string", "id?": "string" } ],
  "markdowns": [ { "id": "string", "message": "string" } ],
  "options": {
    "contentIdsToUpdate?": [ "string" ]
  }
}
```

---

## Permissions

Add the following permissions to your workflow or job:

```yaml
permissions:
  issues: write
  pull-requests: write
```

---

## SDK

The `@balvajs/pr-beacon` package exposes the same engine used by the GitHub Action, letting you build the beacon programmatically in your own Node.js scripts.

### Installation

```sh
npm install @balvajs/pr-beacon
```

**Requirements:** Node.js ≥ 24, must be run inside a GitHub Actions environment with `GITHUB_TOKEN` set.

### `submitPrBeacon(callback, options?)`

The primary entry point. Runs your callback, then submits the accumulated content to the PR comment in one atomic operation.

```ts
import { submitPrBeacon } from '@balvajs/pr-beacon';

await submitPrBeacon(async (beacon) => {
  beacon.fail('Tests failed on Node 22.');
  beacon.warn('Bundle size increased by 12 kB.', { icon: '📦' });
  beacon.message('Preview deployed to https://preview.example.com');
  beacon.markdown('coverage', '## Coverage\n\n94% overall.');
});
```

#### Callback argument — `PrBeacon`

| Method            | Signature                     | Description                                                              |
| ----------------- | ----------------------------- | ------------------------------------------------------------------------ |
| `fail`            | `(message, options?) => void` | Add a row to the **Fails** table.                                        |
| `warn`            | `(message, options?) => void` | Add a row to the **Warnings** table.                                     |
| `message`         | `(message, options?) => void` | Add a row to the **Messages** table.                                     |
| `markdown`        | `(message, options?) => void` | Append a free-form markdown section.                                     |
| `hasFails`        | `() => boolean`               | Returns `true` if any fail was added.                                    |
| `getPrInfo`       | `() => Promise<PrInfo>`       | Fetch pull request metadata (title, head SHA, base/head branches, etc.). |
| `getChangedFiles` | `() => Promise<File[]>`       | Fetch the full list of files changed in the PR.                          |

Row methods accept an optional second argument:

```ts
type RowOptions = {
  icon?: string; // override the default section icon
  id?: string; // content ID for targeted upsert (default: "workflow/job")
  markdownToHtml?: boolean; // convert markdown syntax in the message to HTML
};
```

#### `submitPrBeacon` options

```ts
type Options = {
  githubToken?: string; // defaults to process.env.GITHUB_TOKEN
  contentIdsToUpdate?: string[]; // content IDs to clear before writing (default: ["workflow/job"])
  shouldFailOnFailMessage?: boolean; // call setFailed() when fails are present
};
```

### Advanced — accessing PR info

```ts
import { submitPrBeacon } from '@balvajs/pr-beacon';

await submitPrBeacon(async (beacon) => {
  const pr = await beacon.getPrInfo();
  const files = await beacon.getChangedFiles();

  const hasDbMigration = files.some((f) => f.filename.startsWith('db/migrations/'));

  if (hasDbMigration) {
    beacon.warn(
      `This PR modifies **${files.filter((f) => f.filename.startsWith('db/migrations/')).length}** database migration(s). Please review carefully.`,
      { icon: '🗄️', markdownToHtml: true },
    );
  }

  beacon.message(`PR #${pr.number}: _${pr.title}_`, { markdownToHtml: true });
});
```

### Advanced — multi-job with custom content IDs

```ts
import { submitPrBeacon } from '@balvajs/pr-beacon';

await submitPrBeacon(
  (beacon) => {
    beacon.fail('E2E tests failed on Chrome.');
  },
  {
    contentIdsToUpdate: ['e2e-chrome'],
    shouldFailOnFailMessage: true,
  },
);
```

---

## License

[MIT](LICENSE) © Balvajs
