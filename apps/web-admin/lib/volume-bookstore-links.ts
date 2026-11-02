/** How many bookstore links one volume carries, as the API caps them. */
export const MAX_VOLUME_BOOKSTORE_LINKS = 10;

/** The longest label the API stores, in characters. */
export const MAX_BOOKSTORE_LINK_LABEL_LENGTH = 50;

/** The longest URL the API stores, in characters. */
export const MAX_BOOKSTORE_LINK_URL_LENGTH = 2048;

/**
 * The key a refusal of one link's field is filed under in the Action state.
 * It is the field path the API names in its violation
 * (`bookstore_links[1].url`), so a refusal from either side lands on the row.
 */
export const bookstoreLinkFieldName = (
  index: number,
  field: "label" | "url"
): string => `bookstore_links[${index}].${field}`;
