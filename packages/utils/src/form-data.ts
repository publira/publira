/**
 * `FormData` → plain object, shaped so a zod schema can validate it.
 *
 * A `FormData` entry is `FormDataEntryValue | null`, which is why call sites
 * reach for `String(formData.get("title") ?? "")`. That coercion is not
 * validation, and it turns an uploaded file into the string `"[object File]"`.
 * This helper reads each field for what it actually is — a text value, a
 * repeated text value, or a file — and leaves every check to the schema.
 *
 * ```ts
 * const parsed = seriesSchema.safeParse(
 *   toFormDataInput(formData, {
 *     creatorPublicIds: { kind: "values", name: "creator_public_ids" },
 *     eyeCatchImage: { kind: "file", name: "eye_catch_image" },
 *     title: "value",
 *   })
 * );
 * ```
 */

/**
 * - `value`: single text field → `string | undefined` (a file entry reads as
 *   `undefined` rather than being stringified)
 * - `values`: repeated text field → `string[]`
 * - `file`: single file field → `File | undefined`
 * - `files`: repeated file field → `File[]`
 *
 * An empty `<input type="file">` still submits a zero-byte entry, so file
 * fields drop empty files: "not provided" must not reach the schema as a file.
 */
export type FormDataFieldKind = "file" | "files" | "value" | "values";

export interface FormDataFieldOptions {
  kind: FormDataFieldKind;
  /**
   * Form field name, when it differs from the object key — form controls are
   * `snake_case` here while schema fields are `camelCase`.
   */
  name: string;
}

/** A bare kind uses the object key as the form field name. */
export type FormDataFieldSpec = FormDataFieldKind | FormDataFieldOptions;

type FieldKindOf<S extends FormDataFieldSpec> = S extends FormDataFieldKind
  ? S
  : S extends FormDataFieldOptions
    ? S["kind"]
    : never;

type FormDataFieldValue<K extends FormDataFieldKind> = K extends "file"
  ? File | undefined
  : K extends "files"
    ? File[]
    : K extends "values"
      ? string[]
      : string | undefined;

export type FormDataInput<T extends Record<string, FormDataFieldSpec>> = {
  [K in keyof T]: FormDataFieldValue<FieldKindOf<T[K]>>;
};

const toFile = (entry: FormDataEntryValue | null): File | undefined =>
  entry instanceof File && entry.size > 0 ? entry : undefined;

const readField = (
  formData: FormData,
  name: string,
  kind: FormDataFieldKind
): File[] | string[] | File | string | undefined => {
  if (kind === "file") {
    return toFile(formData.get(name));
  }

  if (kind === "files") {
    return formData.getAll(name).flatMap((entry) => {
      const file = toFile(entry);
      return file ? [file] : [];
    });
  }

  if (kind === "values") {
    return formData
      .getAll(name)
      .filter((entry): entry is string => typeof entry === "string");
  }

  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
};

/**
 * Read the named fields out of `formData`. Values are returned as submitted —
 * trimming, length limits, and every other rule stay in the zod schema, so
 * there is exactly one place describing what the form accepts.
 */
export const toFormDataInput = <T extends Record<string, FormDataFieldSpec>>(
  formData: FormData,
  fields: T
): FormDataInput<T> =>
  Object.fromEntries(
    Object.entries(fields).map(([key, spec]) => {
      const kind = typeof spec === "string" ? spec : spec.kind;
      const name = typeof spec === "string" ? key : spec.name;
      return [key, readField(formData, name, kind)];
    })
  ) as FormDataInput<T>;
