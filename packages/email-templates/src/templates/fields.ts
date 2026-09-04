import { parseInstant } from "@publira/utils";
import { z } from "zod";

import { isHttpUrl } from "../http-url";
import { hasNoLineBreaks } from "../single-line";

/**
 * The field builders every template's `data` schema is assembled from. Each one
 * takes the variable name so the message names the field the sender got wrong,
 * which is all a sender sees when `resolveEmail` answers `invalid_data`.
 */

/** A moment the mail displays, formatted in the time zone `RenderEmail` is given. */
export const instantField = (name: string) =>
  z
    .string()
    .trim()
    .refine((value) => parseInstant(value) !== null, {
      error: `${name} must be an RFC3339 timestamp`,
    });

/** A link the recipient is asked to open. */
export const httpUrlField = (name: string) =>
  z
    .string()
    .trim()
    .refine(isHttpUrl, { error: `${name} must be an http(s) URL` });

/**
 * An email address the mail talks about. It is displayed rather than used as an
 * envelope address, so the address itself is the sender's to validate; what the
 * template refuses is the CR or LF that would let it break out of a header.
 */
export const emailAddressField = (name: string) =>
  z
    .string()
    .trim()
    .min(1)
    .max(254)
    .refine(hasNoLineBreaks, {
      error: `${name} must not contain CR or LF`,
    });

/** A display name that reaches the subject line, such as the tenant's. */
export const displayNameField = (name: string) =>
  z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine(hasNoLineBreaks, {
      error: `${name} must not contain CR or LF`,
    });

/**
 * Which side of an address change a confirmation mail is addressed to. Both
 * sides confirm, and the copy differs, so the sender says which one it is
 * rather than the handler picking a template per side.
 */
export const recipientKindField = () => z.enum(["current_email", "new_email"]);
