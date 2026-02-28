import { readFileSync } from 'node:fs';
import process from 'node:process';

import { getInput, setFailed } from '@actions/core';
import { shake } from 'radashi';
import { z } from 'zod';

import { submitPrBeacon } from '../sdk/index';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const tableRowSchema = z.union([
  z.string(),
  z.object({
    icon: z.string().optional(),
    id: z.string().optional(),
    message: z.string(),
  }),
]);

const markdownEntrySchema = z.object({
  id: z.string(),
  message: z.string(),
});

/** Full JSON payload accepted by the `json-file` input. */
const jsonPayloadSchema = z.object({
  fails: z.array(tableRowSchema).optional(),
  markdowns: z.array(markdownEntrySchema).optional(),
  messages: z.array(tableRowSchema).optional(),
  options: z
    .object({
      contentIdsToUpdate: z.array(z.string()).optional(),
    })
    .optional(),
  warnings: z.array(tableRowSchema).optional(),
});

type JsonPayload = z.infer<typeof jsonPayloadSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return `undefined` when an action input is empty/unset. */
const optionalInput = (name: string): string | undefined => {
  const value = getInput(name);
  return value === '' ? undefined : value;
};

/** Unpack a table-row input into `(message, meta)` arguments. */
const unpackRow = (
  row: z.infer<typeof tableRowSchema>,
): [message: string, meta: { icon?: string; id?: string; markdownToHtml?: boolean }] => {
  if (typeof row === 'string') {
    return [row, { markdownToHtml: true }];
  }

  const { message, ...meta } = row;
  return [message, { ...meta, markdownToHtml: true }];
};

const isEmptyRow = (row: z.infer<typeof tableRowSchema>): boolean => {
  if (typeof row === 'string') {
    return row.trim().length === 0;
  }

  return row.message.trim().length === 0;
};

type PrBeaconArg = Parameters<Parameters<typeof submitPrBeacon>[0]>[0];

/** Apply rows coming from the structured JSON payload. */
const applyJsonPayload = (prBeacon: PrBeaconArg, jsonPayload: JsonPayload): void => {
  for (const row of jsonPayload.fails ?? []) {
    if (!isEmptyRow(row)) {
      prBeacon.fail(...unpackRow(row));
    }
  }
  for (const row of jsonPayload.warnings ?? []) {
    if (!isEmptyRow(row)) {
      prBeacon.warn(...unpackRow(row));
    }
  }
  for (const row of jsonPayload.messages ?? []) {
    if (!isEmptyRow(row)) {
      prBeacon.message(...unpackRow(row));
    }
  }
  for (const { id, message } of jsonPayload.markdowns ?? []) {
    if (message.trim().length > 0) {
      prBeacon.markdown(id, message);
    }
  }
};

type IndividualInputs = {
  failInput: string | undefined;
  failIcon: string | undefined;
  failId: string | undefined;
  messageInput: string | undefined;
  messageIcon: string | undefined;
  messageId: string | undefined;
  warnInput: string | undefined;
  warnIcon: string | undefined;
  warnId: string | undefined;
};

/** Apply plain-string rows coming from individual action inputs. */
const applyIndividualInputs = (prBeacon: PrBeaconArg, inputs: IndividualInputs): void => {
  const {
    failInput,
    failIcon,
    failId,
    warnInput,
    warnIcon,
    warnId,
    messageInput,
    messageIcon,
    messageId,
  } = shake(inputs, (value) => typeof value === 'string' && value.trim().length > 0);

  if (failInput !== undefined) {
    prBeacon.fail(failInput, { icon: failIcon, id: failId, markdownToHtml: true });
  }
  if (warnInput !== undefined) {
    prBeacon.warn(warnInput, { icon: warnIcon, id: warnId, markdownToHtml: true });
  }
  if (messageInput !== undefined) {
    prBeacon.message(messageInput, { icon: messageIcon, id: messageId, markdownToHtml: true });
  }
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

try {
  // Expose the token so the SDK can pick it up
  process.env.GITHUB_TOKEN = getInput('token', { required: true });

  // -- JSON file payload -----------------------------------------------------
  const jsonFile = optionalInput('json-file');

  let jsonPayload: JsonPayload | undefined;

  if (jsonFile !== undefined) {
    const raw = readFileSync(jsonFile, 'utf8');
    jsonPayload = jsonPayloadSchema.parse(JSON.parse(raw) as unknown);
  }

  // -- Individual table-row inputs -------------------------------------------
  const failInput = optionalInput('fail');
  const failIcon = optionalInput('fail-icon');
  const failId = optionalInput('fail-id');
  const warnInput = optionalInput('warn');
  const warnIcon = optionalInput('warn-icon');
  const warnId = optionalInput('warn-id');
  const messageInput = optionalInput('message');
  const messageIcon = optionalInput('message-icon');
  const messageId = optionalInput('message-id');

  // -- Submit options --------------------------------------------------------
  const contentIdsToUpdateRaw = optionalInput('content-ids-to-update');
  const shouldFailOnFailMessage = optionalInput('fail-on-fail-message') === 'true';

  const contentIdsToUpdate =
    contentIdsToUpdateRaw === undefined || contentIdsToUpdateRaw === ''
      ? undefined
      : contentIdsToUpdateRaw
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean);

  // -- Merge submit options (JSON payload options take precedence) -----------
  const resolvedContentIdsToUpdate = jsonPayload?.options?.contentIdsToUpdate ?? contentIdsToUpdate;

  // -- Build and submit the beacon -------------------------------------------
  const buildBeaconCallback: Parameters<typeof submitPrBeacon>[0] = (prBeacon) => {
    if (jsonPayload !== undefined) {
      applyJsonPayload(prBeacon, jsonPayload);
    }
    applyIndividualInputs(prBeacon, {
      failIcon,
      failId,
      failInput,
      messageIcon,
      messageId,
      messageInput,
      warnIcon,
      warnId,
      warnInput,
    });
  };

  await submitPrBeacon(buildBeaconCallback, {
    contentIdsToUpdate: resolvedContentIdsToUpdate,
    shouldFailOnFailMessage,
  });
} catch (error) {
  setFailed(error instanceof Error ? error.message : String(error));
}
