import {
  RPC_ERROR_REASON,
  rpcErrorHasFieldViolation,
  rpcErrorHasReason,
} from "@publira/api-client/errors";

/**
 * Series and label forms both submit metadata and an eye-catch image in one
 * request, and the server answers either kind of problem with
 * `invalid_argument`. The server identifies image failures with a
 * `google.rpc.BadRequest` field violation, so the form can choose the right
 * wording without reading its message.
 *
 * The message itself stays per-form: the size requirements differ.
 */
/** Whether an `invalid_argument` rejection is about the eye-catch image. */
export const mentionsImageRejection = (cause: unknown): boolean =>
  rpcErrorHasFieldViolation(cause, "eye_catch_image_data") ||
  rpcErrorHasFieldViolation(cause, "eye_catch_image_content_type");

/** Whether an `invalid_argument` rejection is about the uploaded icon. */
export const mentionsIconRejection = (cause: unknown): boolean =>
  rpcErrorHasFieldViolation(cause, "icon_data");

/** Whether an `invalid_argument` rejection is about the uploaded logo. */
export const mentionsLogoRejection = (cause: unknown): boolean =>
  rpcErrorHasFieldViolation(cause, "logo_data");

/**
 * Whether an `invalid_argument` rejection is about the uploaded sign-in image.
 * Its RPC is the only one the branding screen calls that carries the image in
 * `image_data`, so the field alone tells it apart.
 */
export const mentionsSignInImageRejection = (cause: unknown): boolean =>
  rpcErrorHasFieldViolation(cause, "image_data");

/**
 * Whether an `invalid_argument` rejection is about the image sent for a single
 * aspect ratio. Those RPCs carry the image in `image_data`, so the whole
 * eye-catch fields above never name it, and the minimum the image missed is
 * the ratio's own — the slot that submitted writes the wording.
 *
 * `crop` counts as the same failure. The console never lets a frame go below
 * the ratio's minimum, so a rectangle the API refuses for its size is one the
 * console could not make any larger: the image behind it is the small one, and
 * that is what the slot's wording tells the editor to replace.
 */
export const mentionsAspectImageRejection = (cause: unknown): boolean =>
  rpcErrorHasFieldViolation(cause, "image_data") ||
  rpcErrorHasFieldViolation(cause, "image_content_type") ||
  rpcErrorHasFieldViolation(cause, "crop");

/**
 * Whether an upload was refused because the platform has no object store saved
 * yet. Only a platform operator can fix that, so every upload surface words it
 * apart from the "try again later" failure a retry could clear.
 */
export const mentionsStorageNotConfigured = (cause: unknown): boolean =>
  rpcErrorHasReason(cause, RPC_ERROR_REASON.storageNotConfigured);
