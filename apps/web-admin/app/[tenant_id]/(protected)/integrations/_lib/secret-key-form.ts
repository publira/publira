import { toFormDataInput } from "@publira/utils/form-data";
import { z } from "zod";

import {
  SECRET_UPDATE_MODE_CLEAR,
  SECRET_UPDATE_MODE_REPLACE,
  SECRET_UPDATE_MODE_UNCHANGED,
} from "#lib/email-settings-shared";
import { flagOneFormSchema, optionalFileFormSchema } from "#lib/form-schemas";

/** A key file is a few kilobytes; anything far larger is not one. */
const MAX_SECRET_KEY_FILE_BYTES = 64 * 1024;

/** What the form did with a stored key: kept its hint, replaced, or cleared it. */
const SECRET_KEY_MODES = ["keep", "replace", "clear"] as const;

/** The fields `SecretKey` posts for one key. */
export const secretKeySchema = (fileTooLarge: string) =>
  z.object({
    configured: flagOneFormSchema,
    file: optionalFileFormSchema.refine(
      (file) => file === undefined || file.size <= MAX_SECRET_KEY_FILE_BYTES,
      fileTooLarge
    ),
    mode: z.enum(SECRET_KEY_MODES),
    text: z.preprocess(
      (value) => (typeof value === "string" ? value : ""),
      z.string()
    ),
  });

type SecretKeyInput = z.output<ReturnType<typeof secretKeySchema>>;

/** A file chosen wins over pasted text, and neither leaves the key as it is. */
const hasNewSecretKey = (key: SecretKeyInput): boolean =>
  key.mode !== "clear" && (key.file !== undefined || key.text.trim() !== "");

/** Whether the key is there after the save, stored or newly entered. */
export const hasSecretKey = (key: SecretKeyInput): boolean =>
  hasNewSecretKey(key) || (key.configured && key.mode === "keep");

/** The key as the API's `SecretUpdateMode` and value. */
export const toSecretKeyUpdate = async (
  key: SecretKeyInput
): Promise<{ mode: number; value: string }> => {
  if (key.mode === "clear") {
    return { mode: SECRET_UPDATE_MODE_CLEAR, value: "" };
  }
  const value = (key.file ? await key.file.text() : key.text).trim();
  return value === ""
    ? { mode: SECRET_UPDATE_MODE_UNCHANGED, value: "" }
    : { mode: SECRET_UPDATE_MODE_REPLACE, value };
};

/** Reads the fields `SecretKey` posted under `name`. */
export const secretKeyFormInput = (formData: FormData, name: string) =>
  toFormDataInput(formData, {
    configured: { kind: "value", name: `${name}_configured` },
    file: { kind: "file", name: `${name}_file` },
    mode: { kind: "value", name: `${name}_mode` },
    text: { kind: "value", name },
  });
