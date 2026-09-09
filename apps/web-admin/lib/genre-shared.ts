/**
 * What the API accepts as a genre name, in code points.
 *
 * Its own module because both graphs need it: the field the editor types into
 * stops here, and the wording of a rejection names the same bound. Everything
 * else about a genre lives in `genre.ts`, which a Client Component may not
 * import.
 */
export const GENRE_NAME_MAX_LENGTH = 50;
