import { diff, escapeHTML, unique } from 'radashi';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TableType = 'fails' | 'messages' | 'warnings';

export type TableRowMessage = {
  message: string;
  icon?: string;
  id?: string;
};

export type MarkdownMessage = {
  message: string;
  id: string;
};

/**
 * Structured form of the beacon comment body.
 *
 * All serialized-format knowledge — HTML comment tags, table HTML, footer
 * markup, escaping — lives in this module. Callers manipulate the structure
 * and only `parseBeacon`/`serializeBeacon` touch the string form.
 */
export type BeaconDocument = {
  tables: Record<TableType, TableRowMessage[]>;
  markdowns: MarkdownMessage[];
};

/**
 * Controls how updated table rows are positioned relative to existing rows.
 *
 * - `'in-place'`: New rows replace at the position of the first old row with the same ID, preserving ordering.
 * - `'append'`: Old rows are removed and new rows are appended at the end of the table.
 */
export type ReplaceMode = 'in-place' | 'append';

// ---------------------------------------------------------------------------
// Serialized format
// ---------------------------------------------------------------------------

const tableSections: Record<TableType, { icon: string; title: string }> = {
  fails: { icon: '🚫', title: 'Fails' },
  messages: { icon: '📖', title: 'Messages' },
  warnings: { icon: '⚠️', title: 'Warnings' },
};

// Order of the table sections in the serialized beacon
const tableTypeKeys: TableType[] = ['fails', 'messages', 'warnings'];

const tableStartTag = (tableType: TableType): string => `<!--${tableType}-section-->`;
const tableEndTag = (tableType: TableType): string => `<!--${tableType}-section-end-->`;
const markdownStartTag = (id: string): string => `<!--markdown-${id}-->`;
const markdownEndTag = (id: string): string => `<!--markdown-${id}-end-->`;

const footerPattern = /<p align="right"><sub>Generated .*?<\/sub><\/p>/g;
// Rows are serialized with no whitespace between tags.
// The tight `</td></tr>` sequence therefore only matches rows produced by this module.
// Nested HTML in messages (e.g. marked output) keeps newlines, so it never hits this pattern.
// Hand-minified HTML containing the tight sequence would truncate the message on parse.
const tableRowPattern =
  /<tr(?: data-id="([^"]*)")?><td>([\s\S]*?)<\/td><td>([\s\S]*?)<\/td><\/tr>/g;
const markdownSectionPattern = /<!--markdown-(.+?)-->([\s\S]*?)<!--markdown-\1-end-->/g;

const tableSectionPattern = (tableType: TableType): RegExp =>
  new RegExp(`${tableStartTag(tableType)}([\\s\\S]*?)${tableEndTag(tableType)}`);

/** Inverse of radashi's `escapeHTML`, used when reading `data-id` attributes back. */
const unescapeHTML = (value: string): string =>
  value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

const parseTableRows = (sectionContent: string): TableRowMessage[] =>
  [...sectionContent.matchAll(tableRowPattern)].map(([, id, icon, message]) => ({
    message: message ?? '',
    ...(icon === undefined ? {} : { icon }),
    ...(id === undefined ? {} : { id: unescapeHTML(id) }),
  }));

/**
 * Parse a serialized beacon comment body into its structured form.
 *
 * Content that is not part of a known section (tables, markdown sections,
 * footer) is dropped — serializing the result normalizes the beacon.
 */
export const parseBeacon = (body: string | undefined): BeaconDocument => {
  if (body === undefined || body === '') {
    return { markdowns: [], tables: { fails: [], messages: [], warnings: [] } };
  }

  const withoutFooter = body.replaceAll(footerPattern, '');

  const parseSection = (tableType: TableType): TableRowMessage[] => {
    const sectionContent = tableSectionPattern(tableType).exec(withoutFooter)?.[1];
    return sectionContent === undefined ? [] : parseTableRows(sectionContent);
  };

  const markdowns = [...withoutFooter.matchAll(markdownSectionPattern)].map(([, id, content]) => ({
    id: id ?? '',
    message: (content ?? '').replace(/^\r?\n\r?\n/, '').replace(/\r?\n$/, ''),
  }));

  return {
    markdowns,
    tables: {
      fails: parseSection('fails'),
      messages: parseSection('messages'),
      warnings: parseSection('warnings'),
    },
  };
};

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

const tableRowHtml = ({ row, tableType }: { row: TableRowMessage; tableType: TableType }): string =>
  `<tr${row.id === undefined ? '' : ` data-id="${escapeHTML(row.id)}"`}><td>${row.icon ?? tableSections[tableType].icon}</td><td>${row.message}</td></tr>`;

const tableHtml = ({
  rows,
  tableType,
}: {
  rows: TableRowMessage[];
  tableType: TableType;
}): string => {
  if (rows.length === 0) {
    return '';
  }

  const headerRow = `<tr><th></th><th>${tableSections[tableType].title}</th></tr>`;
  const messageRows = rows.map((row) => tableRowHtml({ row, tableType })).join('');

  return `<table>${headerRow}${messageRows}</table>`;
};

/**
 * Serialize the structured beacon back into the comment body string.
 * The optional `footer` content is wrapped in the footer markup at the end.
 */
export const serializeBeacon = ({
  document,
  footer,
}: {
  document: BeaconDocument;
  footer?: string;
}): string => {
  const tablesPart = tableTypeKeys
    .map(
      (tableType) =>
        `${tableStartTag(tableType)}${tableHtml({
          rows: document.tables[tableType],
          tableType,
        })}${tableEndTag(tableType)}`,
    )
    .join('');

  const markdownsPart = document.markdowns
    .map(({ id, message }) => `${markdownStartTag(id)}\n\n${message}\n${markdownEndTag(id)}`)
    .join('');

  const footerPart = footer === undefined ? '' : `<p align="right"><sub>${footer}</sub></p>`;

  return `${tablesPart}${markdownsPart}${footerPart}`;
};

// ---------------------------------------------------------------------------
// Table updates
// ---------------------------------------------------------------------------

/** Collect all IDs that need processing from contentIdsToUpdate and new table rows. */
const collectIdsToProcess = ({
  contentIdsToUpdate,
  newTables,
}: {
  contentIdsToUpdate: string[];
  newTables: Record<TableType, TableRowMessage[]>;
}): string[] =>
  unique([
    ...contentIdsToUpdate,
    ...tableTypeKeys.flatMap((tableType) =>
      newTables[tableType].map(({ id }) => id).filter((id): id is string => id !== undefined),
    ),
  ]);

const groupRowsById = (
  rows: TableRowMessage[],
): { rowsById: Map<string, TableRowMessage[]>; rowsWithoutId: TableRowMessage[] } => {
  const rowsById = new Map<string, TableRowMessage[]>();
  const rowsWithoutId: TableRowMessage[] = [];

  for (const row of rows) {
    if (row.id === undefined) {
      rowsWithoutId.push(row);
    } else {
      const group = rowsById.get(row.id);
      if (group === undefined) {
        rowsById.set(row.id, [row]);
      } else {
        group.push(row);
      }
    }
  }

  return { rowsById, rowsWithoutId };
};

/**
 * Replace rows in-place: new rows take the position of the first old row with
 * the same ID, preserving ordering. Remaining old rows with a processed ID are
 * removed; new rows without a matching old row are appended at the end.
 */
const replaceRowsInPlace = ({
  oldRows,
  newRows,
  idsToProcess,
}: {
  oldRows: TableRowMessage[];
  newRows: TableRowMessage[];
  idsToProcess: string[];
}): TableRowMessage[] => {
  const { rowsById, rowsWithoutId } = groupRowsById(newRows);

  const replacedRows: TableRowMessage[] = [];
  const insertedIds = new Set<string>();

  for (const row of oldRows) {
    if (row.id === undefined || !idsToProcess.includes(row.id)) {
      replacedRows.push(row);
    } else {
      const group = rowsById.get(row.id);
      if (group !== undefined && !insertedIds.has(row.id)) {
        replacedRows.push(...group);
        insertedIds.add(row.id);
      }
      // Other old rows with a processed ID are dropped
    }
  }

  const appendQueue = [...rowsWithoutId];
  for (const [id, group] of rowsById) {
    if (!insertedIds.has(id)) {
      appendQueue.push(...group);
    }
  }

  return [...replacedRows, ...appendQueue];
};

/** Remove old rows with processed IDs and append all new rows at the end of the table. */
const replaceRowsAppend = ({
  oldRows,
  newRows,
  idsToProcess,
}: {
  oldRows: TableRowMessage[];
  newRows: TableRowMessage[];
  idsToProcess: string[];
}): TableRowMessage[] => [
  ...oldRows.filter((row) => row.id === undefined || !idsToProcess.includes(row.id)),
  ...newRows,
];

/**
 * Go through all table types and update all of them with data from `newTables`
 */
export const updateTables = ({
  document,
  newTables,
  contentIdsToUpdate,
  replaceMode = 'in-place',
}: {
  document: BeaconDocument;
  newTables: Record<TableType, TableRowMessage[]>;
  contentIdsToUpdate: string[];
  replaceMode?: ReplaceMode;
}): BeaconDocument => {
  const idsToProcess = collectIdsToProcess({ contentIdsToUpdate, newTables });
  const replaceRows = replaceMode === 'in-place' ? replaceRowsInPlace : replaceRowsAppend;

  return {
    ...document,
    tables: {
      fails: replaceRows({
        idsToProcess,
        newRows: newTables.fails,
        oldRows: document.tables.fails,
      }),
      messages: replaceRows({
        idsToProcess,
        newRows: newTables.messages,
        oldRows: document.tables.messages,
      }),
      warnings: replaceRows({
        idsToProcess,
        newRows: newTables.warnings,
        oldRows: document.tables.warnings,
      }),
    },
  };
};

// ---------------------------------------------------------------------------
// Markdown updates
// ---------------------------------------------------------------------------

/**
 * Go through all markdown sections and update all of them with data from `newMarkdowns`
 */
export const updateMarkdowns = ({
  document,
  newMarkdowns,
  contentIdsToUpdate,
}: {
  document: BeaconDocument;
  newMarkdowns: MarkdownMessage[];
  contentIdsToUpdate: string[];
}): BeaconDocument => {
  const newMarkdownIds = newMarkdowns.map(({ id }) => id);
  // Sections meant for removal that are not present in the new markdowns
  const idsToRemove = diff(contentIdsToUpdate, newMarkdownIds);

  let markdowns = document.markdowns.filter(({ id }) => !idsToRemove.includes(id));

  for (const newMarkdown of newMarkdowns) {
    const existingIndex = markdowns.findIndex(({ id }) => id === newMarkdown.id);
    markdowns =
      existingIndex === -1
        ? [...markdowns, newMarkdown]
        : markdowns.with(existingIndex, newMarkdown);
  }

  return { ...document, markdowns };
};

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/**
 * Apply accumulated beacon content to the previous comment body and return the
 * new body: parse → update tables → update markdowns → serialize with footer.
 */
export const renderBeacon = ({
  previousBody,
  newTables,
  newMarkdowns,
  contentIdsToUpdate,
  replaceMode,
  footer,
}: {
  previousBody: string | undefined;
  newTables: Record<TableType, TableRowMessage[]>;
  newMarkdowns: MarkdownMessage[];
  contentIdsToUpdate: string[];
  replaceMode?: ReplaceMode;
  footer?: string;
}): string => {
  const parsedDocument = parseBeacon(previousBody);
  const withTables = updateTables({
    contentIdsToUpdate,
    document: parsedDocument,
    newTables,
    replaceMode,
  });
  const withMarkdowns = updateMarkdowns({
    contentIdsToUpdate,
    document: withTables,
    newMarkdowns,
  });

  return serializeBeacon({ document: withMarkdowns, footer });
};
