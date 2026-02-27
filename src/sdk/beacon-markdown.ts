import { diff } from 'radashi';

export type MarkdownMessage = {
  message: string;
  id: string;
};

const markdownStartTag = (id: string): string => `<!--markdown-${id}-->`;
const markdownEndTag = (id: string): string => `<!--markdown-${id}-end-->`;

const markdownSectionRegexp = (id: string): RegExp =>
  new RegExp(`${markdownStartTag(id)}[\\S\\s]*?${markdownEndTag(id)}`, 'gm');

const removeMarkdownsThatShouldBeUpdated = ({
  oldBeacon,
  contentIdsToUpdate,
  newMarkdowns,
}: {
  oldBeacon: string;
  contentIdsToUpdate: string[];
  newMarkdowns: MarkdownMessage[];
}): string => {
  let newBeacon = oldBeacon;

  const newMarkdownIds = newMarkdowns.map(({ id }) => id);
  // Get markdown ids that are meant for removal, and new present in new markdown ids
  const markdownIdsToRemove = diff(contentIdsToUpdate, newMarkdownIds);

  // Remove only markdown ids that will not be updated later
  for (const markdownIdToRemove of markdownIdsToRemove) {
    newBeacon = newBeacon.replaceAll(markdownSectionRegexp(markdownIdToRemove), '');
  }

  return newBeacon;
};

/**
 * Go through all markdowns and update all of them with data from `newMarkdowns`
 */
export const updateMarkdowns = ({
  oldBeacon,
  contentIdsToUpdate,
  newMarkdowns,
}: {
  oldBeacon: string;
  contentIdsToUpdate: string[];
  newMarkdowns: MarkdownMessage[];
}): string => {
  let newBeacon = oldBeacon;

  newBeacon = removeMarkdownsThatShouldBeUpdated({
    contentIdsToUpdate,
    newMarkdowns,
    oldBeacon,
  });

  for (const { message, id } of newMarkdowns) {
    const newMarkdown = `${markdownStartTag(id)}\n\n${message}\n${markdownEndTag(id)}`;

    if (markdownSectionRegexp(id).test(newBeacon)) {
      newBeacon = newBeacon.replace(markdownSectionRegexp(id), newMarkdown);
    } else {
      newBeacon += newMarkdown;
    }
  }

  return newBeacon;
};
