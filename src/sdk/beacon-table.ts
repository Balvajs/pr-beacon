import { info } from '@actions/core';
import picocolors from 'picocolors';
import { unique } from 'radashi';

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
  `<tr${id === undefined ? '' : ` data-id="${id}"`}><td>${icon ?? tableTypes[tableType].icon}</td><td>${message}</td></tr>`;

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

const regexps = {
  table: (tableType: TableType): RegExp =>
    new RegExp(`${tableStartTag(tableType)}[\\s\\S]*?${tableEndTag(tableType)}`, 'gm'),
  tableRowWithId: (id: string): RegExp => new RegExp(`<tr data-id="${id}">[\\S\\s]*?</tr>`, 'gm'),
  tableWithContent: (tableType: TableType): RegExp =>
    new RegExp(
      `${tableStartTag(tableType)}[\\s\\S]*?<td>[\\s\\S]*?${tableEndTag(tableType)}`,
      'gm',
    ),
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

  const tableContentIds = unique(
    tableTypesKeys.flatMap((tableType) =>
      newTables[tableType].map(({ id }) => id).filter((id): id is string => id !== undefined),
    ),
  );

  const tableIdsToRemove = unique([...contentIdsToUpdate, ...tableContentIds]);

  for (const tableIdToRemove of tableIdsToRemove) {
    newBeacon = newBeacon.replaceAll(regexps.tableRowWithId(tableIdToRemove), '');
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
}: {
  oldBeacon: string;
  newTables: Record<TableType, TableRowMessage[]>;
  contentIdsToUpdate: string[];
}): string => {
  let newBeacon = oldBeacon;

  newBeacon = removeTableRowsThatShouldUpdate({
    contentIdsToUpdate,
    newTables,
    oldBeacon,
  });

  for (const tableType of tableTypesKeys) {
    // If the table has already some content (some <td>), append new rows to the table
    if (regexps.tableWithContent(tableType).test(newBeacon)) {
      for (const message of newTables[tableType]) {
        newBeacon = appendRowToTable({
          comment: newBeacon,
          message,
          tableType: tableType,
        });
      }
    } else {
      const newTable = `${tableStartTag(tableType)}${createTable({
        messages: newTables[tableType],
        type: tableType,
      })}${tableEndTag(tableType)}`;

      // Replace existing table tags with new table
      newBeacon = newBeacon.replace(regexps.table(tableType), newTable);
    }
  }

  return newBeacon;
};
