import { rpcErrorMentions } from "@publira/api-client/errors";

/**
 * Series and label forms both submit metadata and an eye-catch image in one
 * request, and the server answers either kind of problem with
 * `invalid_argument`. These are the tokens its image validation uses
 * (`server/api/adminapi/series_handlers.go`), so they decide whether the form
 * should talk about the image or about the text fields.
 *
 * Shared so a wording change on the server is chased in one place instead of
 * drifting between the two forms. The message itself stays per-form: the size
 * requirements differ.
 */
const IMAGE_REJECTION_HINTS = [
  "eye_catch",
  "image",
  "content_type",
  "10mb",
  "at least",
] as const;

/** Whether an `invalid_argument` rejection is about the eye-catch image. */
export const mentionsImageRejection = (error: unknown): boolean =>
  IMAGE_REJECTION_HINTS.some((hint) => rpcErrorMentions(error, hint));
