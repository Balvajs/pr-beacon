import { readFileSync } from 'node:fs';
import process from 'node:process';

import { getInput, setFailed } from '@actions/core';
import { select, sift } from 'radashi';
import { z } from 'zod';

import { submitPrBeacon } from '../sdk/index.ts';

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

const markdownEntrySchema = z.union([
  z.string(),
  z.object({
    id: z.string().optional(),
    message: z.string(),
  }),
]);

/** Full JSON payload accepted by the `json-file` input. */
const jsonPayloadSchema = z.object({
  fails: z.array(tableRowSchema).optional(),
  markdowns: z.array(markdownEntrySchema).optional(),
  messages: z.array(tableRowSchema).optional(),
  options: z
    .object({
      contentIdsToUpdate: z.array(z.string()).optional(),
      replaceMode: z.enum(['in-place', 'append']).optional(),
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

type EntryWithMessage = string | { message: string; id?: string };

const isEmptyEntry = (entry: EntryWithMessage): boolean =>
  typeof entry === 'string' ? entry.trim().length === 0 : entry.message.trim().length === 0;

const getEntryId = (entry: EntryWithMessage): string | undefined =>
  typeof entry === 'string' ? undefined : entry.id;

type PrBeaconArg = Parameters<Parameters<typeof submitPrBeacon>[0]>[0];

const applyJsonPayload = (prBeacon: PrBeaconArg, jsonPayload: JsonPayload): void => {
  for (const row of jsonPayload.fails ?? []) {
    if (!isEmptyEntry(row)) {
      prBeacon.fail(...unpackRow(row));
    }
  }
  for (const row of jsonPayload.warnings ?? []) {
    if (!isEmptyEntry(row)) {
      prBeacon.warn(...unpackRow(row));
    }
  }
  for (const row of jsonPayload.messages ?? []) {
    if (!isEmptyEntry(row)) {
      prBeacon.message(...unpackRow(row));
    }
  }
  for (const entry of jsonPayload.markdowns ?? []) {
    if (!isEmptyEntry(entry)) {
      if (typeof entry === 'string') {
        prBeacon.markdown(entry);
      } else {
        prBeacon.markdown(entry.message, { id: entry.id });
      }
    }
  }
};

type IndividualInputs = {
  failInput: string | undefined;
  failIcon: string | undefined;
  failId: string | undefined;
  markdownInput: string | undefined;
  markdownId: string | undefined;
  messageInput: string | undefined;
  messageIcon: string | undefined;
  messageId: string | undefined;
  warnInput: string | undefined;
  warnIcon: string | undefined;
  warnId: string | undefined;
};

const applyIndividualInputs = (prBeacon: PrBeaconArg, inputs: IndividualInputs): void => {
  const {
    failInput,
    failIcon,
    failId,
    markdownInput,
    markdownId,
    warnInput,
    warnIcon,
    warnId,
    messageInput,
    messageIcon,
    messageId,
  } = inputs;

  if (failInput !== undefined) {
    prBeacon.fail(failInput, { icon: failIcon, id: failId, markdownToHtml: true });
  }
  if (warnInput !== undefined) {
    prBeacon.warn(warnInput, { icon: warnIcon, id: warnId, markdownToHtml: true });
  }
  if (messageInput !== undefined) {
    prBeacon.message(messageInput, { icon: messageIcon, id: messageId, markdownToHtml: true });
  }
  if (markdownInput !== undefined) {
    prBeacon.markdown(markdownInput, { id: markdownId });
  }
};

/**
 * Collect IDs from inputs/payload entries that have an ID but no message content.
 * These "orphan" IDs must still be added to contentIdsToUpdate so that old rows
 * with those IDs are removed from the beacon.
 */
const collectOrphanIds = (
  inputs: IndividualInputs,
  jsonPayload: JsonPayload | undefined,
): string[] => {
  const ids: string[] = [];

  if (inputs.failInput === undefined && inputs.failId !== undefined) {
    ids.push(inputs.failId);
  }
  if (inputs.warnInput === undefined && inputs.warnId !== undefined) {
    ids.push(inputs.warnId);
  }
  if (inputs.messageInput === undefined && inputs.messageId !== undefined) {
    ids.push(inputs.messageId);
  }
  if (inputs.markdownInput === undefined && inputs.markdownId !== undefined) {
    ids.push(inputs.markdownId);
  }

  if (jsonPayload !== undefined) {
    const arrays: (EntryWithMessage[] | undefined)[] = [
      jsonPayload.fails,
      jsonPayload.warnings,
      jsonPayload.messages,
      jsonPayload.markdowns,
    ];
    for (const array of arrays) {
      if (array !== undefined) {
        ids.push(...sift(select(array, getEntryId, isEmptyEntry)));
      }
    }
  }

  return ids;
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
  const markdownInput = optionalInput('markdown');
  const markdownId = optionalInput('markdown-id');

  // -- Submit options --------------------------------------------------------
  const contentIdsToUpdateRaw = optionalInput('content-ids-to-update');
  const shouldFailOnFailMessage = optionalInput('fail-on-fail-message') === 'true';
  const replaceModeRaw = optionalInput('replace-mode');
  const replaceMode =
    replaceModeRaw === 'in-place' || replaceModeRaw === 'append' ? replaceModeRaw : undefined;

  const contentIdsToUpdate =
    contentIdsToUpdateRaw === undefined || contentIdsToUpdateRaw === ''
      ? undefined
      : contentIdsToUpdateRaw
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean);

  // -- Merge submit options (JSON payload options take precedence) -----------
  const resolvedReplaceMode = jsonPayload?.options?.replaceMode ?? replaceMode;

  const individualInputs: IndividualInputs = {
    failIcon,
    failId,
    failInput,
    markdownId,
    markdownInput,
    messageIcon,
    messageId,
    messageInput,
    warnIcon,
    warnId,
    warnInput,
  };

  // Collect IDs from inputs that have an ID but no message — these still need
  // To clear old rows with that ID from the beacon.
  const orphanIds = collectOrphanIds(individualInputs, jsonPayload);
  const baseContentIds = jsonPayload?.options?.contentIdsToUpdate ?? contentIdsToUpdate;
  const resolvedContentIdsToUpdate =
    orphanIds.length > 0 ? [...(baseContentIds ?? []), ...orphanIds] : baseContentIds;

  // -- Build and submit the beacon -------------------------------------------
  const buildBeaconCallback: Parameters<typeof submitPrBeacon>[0] = (prBeacon) => {
    if (jsonPayload !== undefined) {
      applyJsonPayload(prBeacon, jsonPayload);
    }
    applyIndividualInputs(prBeacon, individualInputs);
  };

  await submitPrBeacon(buildBeaconCallback, {
    contentIdsToUpdate: resolvedContentIdsToUpdate,
    replaceMode: resolvedReplaceMode,
    shouldFailOnFailMessage,
  });
} catch (error) {
  setFailed(error instanceof Error ? error.message : String(error));
}
