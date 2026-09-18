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

/** A display name the mail is branded with, such as the tenant's. */
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

/**
 * Whether the account a mail talks about has had its email address confirmed.
 * The two states have different ways back in — a confirmed account is reached
 * through the reset form, an unconfirmed one only through a new confirmation
 * mail — so the sender says which one it found and the copy follows it.
 */
export const accountStateField = () => z.enum(["confirmed", "unconfirmed"]);

/**
 * A short value the mail shows when there is one. It is the empty string rather
 * than an absent key when there is nothing to show, so one template's `data`
 * has the same shape whatever the sender found, and the component decides
 * whether the line appears.
 */
export const optionalSingleLineField = (name: string, max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(hasNoLineBreaks, {
      error: `${name} must not contain CR or LF`,
    });

/**
 * Text somebody other than the sender wrote, shown as they typed it. Its line
 * breaks are part of what they wrote, so this is the one field that keeps them;
 * it reaches the mail as content rather than as a header, so there is nothing
 * for a CR or LF to break out of.
 */
export const quotedTextField = (name: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, { error: `${name} is required` })
    .max(max);
