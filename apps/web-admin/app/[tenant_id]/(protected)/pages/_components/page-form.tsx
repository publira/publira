"use client";

import { Button } from "@publira/ui-components/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Textarea } from "@publira/ui-components/textarea";
import { useActionState, useCallback, useState } from "react";
import type { ChangeEvent } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";
import { useTenantId } from "#lib/use-tenant-id";

import { formatPagePath, normalizePageSlugInput } from "../page-types";
import type { PageFormState, PageListItem } from "../page-types";

interface PageFormProps {
  action: (
    prevState: PageFormState,
    formData: FormData
  ) => Promise<PageFormState>;
  initialPage?: PageListItem;
  mode: "create" | "update";
}

export const PageForm = ({ action, initialPage, mode }: PageFormProps) => {
  const t = useClientMessages();
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  // Initial values only; entity switch must remount the form via key on the parent.
  const [contentMarkdown, setContentMarkdown] = useState("");
  const [slug, setSlug] = useState(initialPage?.slug ?? "");
  const [title, setTitle] = useState(initialPage?.title ?? "");
  const [displayInFooter, setDisplayInFooter] = useState(
    initialPage?.displayInFooter ?? false
  );

  const isUpdate = mode === "update";
  const slugError = state?.field === "slug" ? state.message : null;
  const formError = state && !slugError ? state.message : null;
  const handleSlugBlur = useCallback(() => {
    setSlug((current) => normalizePageSlugInput(current));
  }, []);
  const handleSlugChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setSlug(event.target.value);
    },
    []
  );
  const handleTitleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setTitle(event.target.value);
    },
    []
  );
  const handleDisplayInFooterChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setDisplayInFooter(event.target.checked);
    },
    []
  );
  const handleContentMarkdownChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      setContentMarkdown(event.target.value);
    },
    []
  );

  let submitLabel = t("admin.pages.form.create");
  if (isPending) {
    submitLabel = t("admin.pages.form.submitting");
  } else if (isUpdate) {
    submitLabel = t("admin.pages.form.update");
  }

  return (
    <form action={formAction} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="page_id" type="hidden" value={initialPage?.id ?? ""} />
      <input
        name="display_in_footer"
        type="hidden"
        value={displayInFooter ? "true" : "false"}
      />

      <Field invalid={slugError !== null}>
        <FieldLabel>slug</FieldLabel>
        <FieldContent>
          <Input
            disabled={isUpdate}
            name="slug"
            onBlur={handleSlugBlur}
            onChange={handleSlugChange}
            placeholder="/privacy"
            type="text"
            value={slug}
          />
          <FieldDescription>
            <ClientMessage
              message="admin.pages.form.slug_description"
              values={{
                path: formatPagePath(slug),
              }}
            />
          </FieldDescription>
          {slugError ? (
            <FormMessage variant="destructive">{slugError}</FormMessage>
          ) : null}
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel required>
          <ClientMessage message="admin.pages.form.title" />
        </FieldLabel>
        <FieldContent>
          <Input
            name="title"
            onChange={handleTitleChange}
            placeholder={t("admin.pages.form.title_placeholder")}
            required
            type="text"
            value={title}
          />
        </FieldContent>
      </Field>

      <Field>
        <FieldContent>
          <label className="inline-flex items-center gap-2 text-sm text-foreground">
            <input
              checked={displayInFooter}
              onChange={handleDisplayInFooterChange}
              type="checkbox"
            />
            <ClientMessage message="admin.pages.form.footer_visible" />
          </label>
          <FieldDescription>
            <ClientMessage message="admin.pages.form.footer_description" />
          </FieldDescription>
        </FieldContent>
      </Field>

      {isUpdate ? null : (
        <Field>
          <FieldLabel>
            <ClientMessage message="admin.pages.form.body" />
          </FieldLabel>
          <FieldContent>
            <Textarea
              name="content_markdown"
              onChange={handleContentMarkdownChange}
              placeholder={t("admin.pages.form.body_placeholder")}
              rows={16}
              value={contentMarkdown}
            />
            <FieldDescription>
              <ClientMessage message="admin.pages.form.body_description" />
            </FieldDescription>
          </FieldContent>
        </Field>
      )}

      {formError ? (
        <FormMessage variant="destructive">{formError}</FormMessage>
      ) : null}

      <div className="flex justify-end">
        <Button disabled={isPending} type="submit">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
};
