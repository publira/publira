/**
 * What a script reads a parsed file as before it checks what the file holds:
 * the values `JSON.parse` returns, which `yaml`'s `parse` returns too for the
 * frontmatter of a page.
 */
export type JsonValue =
  | boolean
  | number
  | string
  | null
  | readonly JsonValue[]
  | JsonObject;

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export const isJsonObject = (
  value: JsonValue | undefined
): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isJsonString = (value: JsonValue | undefined): value is string =>
  typeof value === "string";
