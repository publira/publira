"use client";

import {
  ActionFormFieldError,
  useActionFormState,
} from "@publira/ui-components/action-form";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
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
  const state = useActionFormState();
  const [slug, setSlug] = useState("");

  return (
    <Field invalid={state?.ok === false && Boolean(state.fieldErrors?.slug)}>
      <FieldLabel>slug</FieldLabel>
      <FieldContent>
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
        <FieldDescription>
          <ClientMessage
            message="admin.pages.form.slug_description"
            values={{ path: formatPagePath(slug) }}
          />
        </FieldDescription>
        <ActionFormFieldError name="slug" />
      </FieldContent>
    </Field>
  );
};
