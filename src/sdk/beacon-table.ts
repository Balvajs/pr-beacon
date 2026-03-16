import { info } from '@actions/core';
import picocolors from 'picocolors';
import { unique, escapeHTML } from 'radashi';

export type TableRowMessage = {
  message: string;
  icon?: string;
  id?: string;
};

const tableTypes = {
  fails: {
    icon: '🚫',
    log: (message: string) => {
      info(picocolors.red(`${picocolors.bold('🚫 FAIL')}: ${message}\n\n`));
    },
    title: 'Fails',
  },
  messages: {
    icon: '📖',
    log: (message: string, icon: string | undefined) => {
      info(`${icon ?? '📖'} ${message}\n\n`);
    },
    title: 'Messages',
  },
  warnings: {
    icon: '⚠️',
    log: (message: string) => {
      info(picocolors.yellow(`${picocolors.bold('⚠️ WARNING')}: ${message}\n\n`));
    },
    title: 'Warnings',
  },
} as const;

export type TableType = keyof typeof tableTypes;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const tableTypesKeys = Object.keys(tableTypes) as TableType[];

const tableStartTag = (sectionType: TableType): string => `<!--${sectionType}-section-->`;
const tableEndTag = (sectionType: TableType): string => `<!--${sectionType}-section-end-->`;

export const emptyTablesTemplate = tableTypesKeys
  .map((tableType) => `${tableStartTag(tableType)}${tableEndTag(tableType)}`)
  .join('');

const tableRowTemplate = ({
  message: { message, id, icon },
  tableType,
}: {
  message: TableRowMessage;
  tableType: TableType;
}): string =>
  `<tr${id === undefined ? '' : ` data-id="${escapeHTML(id)}"`}><td>${icon ?? tableTypes[tableType].icon}</td><td>${message}</td></tr>`;

const createTable = ({
  messages,
  type,
}: {
  messages: TableRowMessage[];
  type: TableType;
}): string => {
  const headerRow = `<tr><th></th><th>${tableTypes[type].title}</th></tr>`;
  const messageRows = messages.map((message) => tableRowTemplate({ message, tableType: type }));

  // Log the messages
  for (const { message, icon } of messages) {
    tableTypes[type].log(message, icon);
  }

  const table = messageRows.length > 0 ? `<table>${headerRow}${messageRows.join('')}</table>` : '';

  return table;
};

const appendRowToTable = ({
  comment,
  tableType,
  message,
}: {
  comment: string;
  tableType: TableType;
  message: TableRowMessage;
}): string => {
  // Log the message
  tableTypes[tableType].log(message.message, message.icon);

  return comment.replace(
    `</table>${tableEndTag(tableType)}`,
    `${tableRowTemplate({ message, tableType })}</table>${tableEndTag(tableType)}`,
  );
};

const escapeRegExp = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

export type ReplaceMode = 'in-place' | 'append';

const tableRowWithIdPattern = (id: string): string =>
  `<tr data-id="${escapeRegExp(escapeHTML(id))}">[\\S\\s]*?</tr>`;

const regexps = {
  table: (tableType: TableType): RegExp =>
    new RegExp(`${tableStartTag(tableType)}[\\s\\S]*?${tableEndTag(tableType)}`, 'gm'),
  tableRowWithId: (id: string): RegExp => new RegExp(tableRowWithIdPattern(id), 'gm'),
  tableRowWithIdFirst: (id: string): RegExp => new RegExp(tableRowWithIdPattern(id), 'm'),
  tableWithContent: (tableType: TableType): RegExp =>
    new RegExp(
      `${tableStartTag(tableType)}[\\s\\S]*?<td>[\\s\\S]*?${tableEndTag(tableType)}`,
      'gm',
    ),
};

const rowPlaceholder = (id: string): string => `<!--row-placeholder-${escapeHTML(id)}-->`;

/** Collect all IDs that need processing from contentIdsToUpdate and new table rows. */
const collectAllIds = ({
  contentIdsToUpdate,
  newTables,
}: {
  contentIdsToUpdate: string[];
  newTables: Record<TableType, TableRowMessage[]>;
}): string[] => {
  const tableContentIds = unique(
    tableTypesKeys.flatMap((tableType) =>
      newTables[tableType].map(({ id }) => id).filter((id): id is string => id !== undefined),
    ),
  );
  return unique([...contentIdsToUpdate, ...tableContentIds]);
};

/** Append messages to an existing table section, or create a new table if empty. */
const appendOrCreateTableSection = ({
  beacon,
  messages,
  tableType,
}: {
  beacon: string;
  messages: TableRowMessage[];
  tableType: TableType;
}): string => {
  let result = beacon;

  if (regexps.tableWithContent(tableType).test(result)) {
    for (const message of messages) {
      result = appendRowToTable({
        comment: result,
        message,
        tableType,
      });
    }
  } else {
    const newTable = `${tableStartTag(tableType)}${createTable({
      messages,
      type: tableType,
    })}${tableEndTag(tableType)}`;
    result = result.replace(regexps.table(tableType), newTable);
  }

  return result;
};

/**
 * Remove table rows that should be updated
 * based on `contentIdsToUpdate` and new IDs from `newTables`
 */
const removeTableRowsThatShouldUpdate = ({
  oldBeacon,
  contentIdsToUpdate,
  newTables,
}: {
  oldBeacon: string;
  contentIdsToUpdate: string[];
  newTables: Record<TableType, TableRowMessage[]>;
}): string => {
  let newBeacon = oldBeacon;

  const idsToRemove = collectAllIds({ contentIdsToUpdate, newTables });

  for (const id of idsToRemove) {
    newBeacon = newBeacon.replaceAll(regexps.tableRowWithId(id), '');
  }

  return newBeacon;
};

/**
 * Replace table rows in-place: new rows take the position of the first matching old row,
 * preserving ordering. Remaining old rows with the same ID are removed.
 */
const replaceTableRowsInPlace = ({
  oldBeacon,
  newTables,
  contentIdsToUpdate,
}: {
  oldBeacon: string;
  newTables: Record<TableType, TableRowMessage[]>;
  contentIdsToUpdate: string[];
}): string => {
  let newBeacon = oldBeacon;

  const allIdsToProcess = collectAllIds({ contentIdsToUpdate, newTables });

  // Step 1: For each ID, replace FIRST occurrence with a placeholder, remove the rest
  for (const id of allIdsToProcess) {
    newBeacon = newBeacon.replace(regexps.tableRowWithIdFirst(id), rowPlaceholder(id));
    // Remove any remaining rows with this ID
    newBeacon = newBeacon.replaceAll(regexps.tableRowWithId(id), '');
  }

  // Step 2: For each table type, group new rows by ID and replace placeholders
  for (const tableType of tableTypesKeys) {
    const rowsByTableType = newTables[tableType];

    // Group rows by ID
    const rowsById = new Map<string, TableRowMessage[]>();
    const rowsWithoutId: TableRowMessage[] = [];

    for (const message of rowsByTableType) {
      if (message.id === undefined) {
        rowsWithoutId.push(message);
      } else {
        const existing = rowsById.get(message.id);
        if (existing === undefined) {
          rowsById.set(message.id, [message]);
        } else {
          existing.push(message);
        }
      }
    }

    // Replace placeholders with grouped rows
    const appendQueue: TableRowMessage[] = [...rowsWithoutId];

    for (const [id, messages] of rowsById) {
      const placeholder = rowPlaceholder(id);
      if (newBeacon.includes(placeholder)) {
        const rowsHtml = messages
          .map((message) => tableRowTemplate({ message, tableType }))
          .join('');
        newBeacon = newBeacon.replace(placeholder, rowsHtml);
        // Log the messages
        for (const message of messages) {
          tableTypes[tableType].log(message.message, message.icon);
        }
      } else {
        appendQueue.push(...messages);
      }
    }

    // Append remaining rows (no placeholder found) to the table
    if (appendQueue.length > 0) {
      newBeacon = appendOrCreateTableSection({
        beacon: newBeacon,
        messages: appendQueue,
        tableType,
      });
    }
  }

  // Step 3: Clean up leftover placeholders (IDs that were only removed, not replaced)
  for (const id of allIdsToProcess) {
    newBeacon = newBeacon.replaceAll(rowPlaceholder(id), '');
  }

  // Handle empty table sections: if a table section has no content, recreate it empty
  for (const tableType of tableTypesKeys) {
    if (!regexps.tableWithContent(tableType).test(newBeacon)) {
      const newTable = `${tableStartTag(tableType)}${tableEndTag(tableType)}`;
      newBeacon = newBeacon.replace(regexps.table(tableType), newTable);
    }
  }

  return newBeacon;
};

/**
 * Go through all table types and update all of them with data from `newTables`
 */
export const updateTables = ({
  oldBeacon,
  newTables,
  contentIdsToUpdate,
  replaceMode = 'in-place',
}: {
  oldBeacon: string;
  newTables: Record<TableType, TableRowMessage[]>;
  contentIdsToUpdate: string[];
  replaceMode?: ReplaceMode;
}): string => {
  if (replaceMode === 'in-place') {
    return replaceTableRowsInPlace({ contentIdsToUpdate, newTables, oldBeacon });
  }

  let newBeacon = oldBeacon;

  newBeacon = removeTableRowsThatShouldUpdate({
    contentIdsToUpdate,
    newTables,
    oldBeacon,
  });

  for (const tableType of tableTypesKeys) {
    newBeacon = appendOrCreateTableSection({
      beacon: newBeacon,
      messages: newTables[tableType],
      tableType,
    });
  }

  return newBeacon;
};
