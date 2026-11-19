"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { useState } from "react";

import { ClientMessage } from "#components/client-message";

import { formatPagePath, normalizePageSlugInput } from "../page-types";

/**
 * The path a new page is published at. It is tidied when the editor leaves it,
 * and the description names the URL it makes as it is typed, so its copy is
 * resolved here rather than on the server.
 */
export const PageSlugField = () => {
  const state = ActionForm.useState();
  const [slug, setSlug] = useState("");

  return (
    <Field.Root
      invalid={state?.ok === false && Boolean(state.fieldErrors?.slug)}
    >
      <Field.Label>slug</Field.Label>
      <Field.Content>
        <Input
          name="slug"
          onBlur={() => {
            setSlug((current) => normalizePageSlugInput(current));
          }}
          onChange={(event) => {
            setSlug(event.target.value);
          }}
          placeholder="/privacy"
          type="text"
          value={slug}
        />
        <Field.Description>
          <ClientMessage
            message="admin.pages.form.slug_description"
            values={{ path: formatPagePath(slug) }}
          />
        </Field.Description>
        <ActionForm.FieldError name="slug" />
      </Field.Content>
    </Field.Root>
  );
};
