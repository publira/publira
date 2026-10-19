// @vitest-environment jsdom

import { bindMessages } from "@publira/i18n";
import type { MessageKey, MessageValues } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GenreListItem } from "../genre-types";
import { GenreNamesForm } from "./genre-names-form";

// The Action is `"use server"`, so the module it lives in cannot be evaluated
// here at all.
vi.mock("../_lib/actions", () => ({
  renameGenreAction: vi.fn(),
}));

vi.mock("#components/message", () => ({
  Message: ({
    message,
    values,
  }: {
    message: MessageKey<SharedMessages>;
    values?: MessageValues;
  }) => bindMessages(sharedCatalog("en"), "en")(message, values),
}));

const genre: GenreListItem = {
  eyeCatchImageUpdatedAt: "",
  eyeCatchImageVariants: [],
  id: "018f0e6a-6000-7000-8000-000000000001",
  name: "Fantaji",
  publicId: "GENRE001",
  slug: "fantaji",
  translations: [
    { locale: "ja", name: "Fantaji" },
    { locale: "en", name: "Fantasy" },
    { locale: "ko", name: "Fantasia" },
  ],
};

// The fields are labelled by each language's own name for itself, which the
// required one follows with its mark.
const nameField = (language: string) =>
  screen.getByRole<HTMLInputElement>("textbox", {
    name: new RegExp(`^${language}`, "u"),
  });

afterEach(() => {
  cleanup();
});

describe("GenreNamesForm", () => {
  it("reads back the name in every language the site offers", () => {
    render(
      <GenreNamesForm
        genre={genre}
        namePlaceholder="Example: Fantasy"
        tenantId="TENANT001"
        tenantLocales={{ defaultLocale: "ja", supportedLocales: ["ja", "en"] }}
      />
    );

    expect(nameField("日本語").value).toBe("Fantaji");
    expect(nameField("English").value).toBe("Fantasy");
  });

  it("shows no field for a language the site does not offer, even one the genre has a name in", () => {
    render(
      <GenreNamesForm
        genre={genre}
        namePlaceholder="Example: Fantasy"
        tenantId="TENANT001"
        tenantLocales={{ defaultLocale: "ja", supportedLocales: ["ja", "en"] }}
      />
    );

    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(screen.queryByRole("textbox", { name: "한국어" })).toBeNull();
  });

  it("requires the default language's name alone, and puts it first", () => {
    render(
      <GenreNamesForm
        genre={genre}
        namePlaceholder="Example: Fantasy"
        tenantId="TENANT001"
        tenantLocales={{ defaultLocale: "en", supportedLocales: ["ja", "en"] }}
      />
    );

    const [first, second] = screen.getAllByRole<HTMLInputElement>("textbox");
    expect(first).toBe(nameField("English"));
    expect(first?.required).toBe(true);
    expect(second?.required).toBe(false);
  });

  it("names the genre in the default language alone when the site's languages cannot be read", () => {
    render(
      <GenreNamesForm
        genre={genre}
        namePlaceholder="Example: Fantasy"
        tenantId="TENANT001"
        tenantLocales={null}
      />
    );

    const field = screen.getByRole<HTMLInputElement>("textbox", {
      name: /Genre name/u,
    });
    expect(field.value).toBe("Fantaji");
    expect(field.name).toBe("name");
  });
});
