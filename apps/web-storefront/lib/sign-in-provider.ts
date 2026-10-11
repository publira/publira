/**
 * The providers a reader can sign in with besides an email address. Kept free
 * of server-only imports, so a Client Component can name them too.
 */
export const SIGN_IN_PROVIDERS = ["apple", "google"] as const;

export type SignInProvider = (typeof SIGN_IN_PROVIDERS)[number];

/** Proper nouns, the same in every locale. */
export const SIGN_IN_PROVIDER_NAMES: Record<SignInProvider, string> = {
  apple: "Apple",
  google: "Google",
};
