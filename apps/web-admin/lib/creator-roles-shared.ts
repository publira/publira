/**
 * What the API accepts as a creator role name, in code points.
 *
 * Its own module because both graphs need it: the field the editor types into
 * stops here, and the wording of a rejection names the same bound. Everything
 * else about a role lives in `creator-roles.ts`, which a Client Component may
 * not import.
 */
export const CREATOR_ROLE_NAME_MAX_LENGTH = 50;
