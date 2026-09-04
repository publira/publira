import { describe, expect, it } from "vitest";
import { z } from "zod";

import { toFormDataInput } from "./form-data";

describe("toFormDataInput", () => {
  it("reads a text field, keeping the value as submitted", () => {
    const formData = new FormData();
    formData.set("title", "  Title  ");

    expect(toFormDataInput(formData, { title: "value" })).toEqual({
      title: "  Title  ",
    });
  });

  it("reports a missing text field as undefined, not an empty string", () => {
    expect(toFormDataInput(new FormData(), { title: "value" })).toEqual({
      title: undefined,
    });
  });

  it("never stringifies a file into a text field", () => {
    const formData = new FormData();
    formData.set("title", new File(["x"], "cover.png", { type: "image/png" }));

    expect(toFormDataInput(formData, { title: "value" }).title).toBeUndefined();
  });

  it("collects a repeated text field", () => {
    const formData = new FormData();
    formData.append("creator_public_ids", "a");
    formData.append("creator_public_ids", "b");

    expect(
      toFormDataInput(formData, {
        creatorPublicIds: { kind: "values", name: "creator_public_ids" },
      })
    ).toEqual({ creatorPublicIds: ["a", "b"] });
  });

  it("returns an empty list for an absent repeated field", () => {
    expect(toFormDataInput(new FormData(), { tags: "values" })).toEqual({
      tags: [],
    });
  });

  it("reads a file field and maps the form name to the schema field", () => {
    const file = new File(["png"], "cover.png", { type: "image/png" });
    const formData = new FormData();
    formData.set("eye_catch_image", file);

    expect(
      toFormDataInput(formData, {
        eyeCatchImage: { kind: "file", name: "eye_catch_image" },
      })
    ).toEqual({ eyeCatchImage: file });
  });

  it("treats an empty file input as not provided", () => {
    const formData = new FormData();
    formData.set("eye_catch_image", new File([], ""));

    expect(
      toFormDataInput(formData, {
        eyeCatchImage: { kind: "file", name: "eye_catch_image" },
      }).eyeCatchImage
    ).toBeUndefined();
  });

  it("collects repeated file fields, dropping empty ones and text entries", () => {
    const first = new File(["1"], "1.png", { type: "image/png" });
    const second = new File(["2"], "2.png", { type: "image/png" });
    const formData = new FormData();
    formData.append("pages", first);
    formData.append("pages", new File([], ""));
    formData.append("pages", second);
    formData.append("pages", "not-a-file");

    expect(toFormDataInput(formData, { pages: "files" })).toEqual({
      pages: [first, second],
    });
  });

  it("feeds a zod schema that owns every rule", () => {
    const schema = z.object({
      isPublished: z
        .string()
        .optional()
        .transform((value) => value === "on"),
      title: z.string().trim().min(1).max(255),
    });

    const formData = new FormData();
    formData.set("title", "  Series title  ");
    formData.set("is_published", "on");

    const parsed = schema.safeParse(
      toFormDataInput(formData, {
        isPublished: { kind: "value", name: "is_published" },
        title: "value",
      })
    );

    expect(parsed).toMatchObject({
      data: { isPublished: true, title: "Series title" },
      success: true,
    });
  });

  it("makes a missing required field a schema error rather than an empty value", () => {
    const schema = z.object({ title: z.string().trim().min(1) });
    const parsed = schema.safeParse(
      toFormDataInput(new FormData(), { title: "value" })
    );

    expect(parsed.success).toBe(false);
  });
});
