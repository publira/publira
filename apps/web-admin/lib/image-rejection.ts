import { rpcErrorHasFieldViolation } from "@publira/api-client/errors";

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
export const mentionsImageRejection = (error: unknown): boolean =>
  rpcErrorHasFieldViolation(error, "eye_catch_image_data") ||
  rpcErrorHasFieldViolation(error, "eye_catch_image_content_type");

/** Whether an `invalid_argument` rejection is about the uploaded icon. */
export const mentionsIconRejection = (error: unknown): boolean =>
  rpcErrorHasFieldViolation(error, "icon_data");

/** Whether an `invalid_argument` rejection is about the uploaded logo. */
export const mentionsLogoRejection = (error: unknown): boolean =>
  rpcErrorHasFieldViolation(error, "logo_data");

/**
 * Whether an `invalid_argument` rejection is about the image sent for a single
 * aspect ratio. Those RPCs carry the image in `image_data`, so the whole
 * eye-catch fields above never name it, and the minimum the image missed is
 * the ratio's own — the slot that submitted writes the wording.
 */
export const mentionsAspectImageRejection = (error: unknown): boolean =>
  rpcErrorHasFieldViolation(error, "image_data") ||
  rpcErrorHasFieldViolation(error, "image_content_type");
