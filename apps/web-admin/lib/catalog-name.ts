/**
 * What the API accepts as the name of a genre or of a tag, in code points.
 *
 * One bound rather than two, because the API normalizes both names through the
 * same rule: trim, length, and a slug derived from what is left. A genre is
 * typed on the genres screen and a tag on the series form, so the field that
 * stops at this length and the wording of a rejection that names it are in
 * different graphs — which is why the number lives in a module of its own,
 * clear of `genre.ts`, which a Client Component may not import.
 */
export const CATALOG_NAME_MAX_LENGTH = 50;
