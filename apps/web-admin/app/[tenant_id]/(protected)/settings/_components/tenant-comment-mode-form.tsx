"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { RadioGroup } from "@publira/ui-components/radio-group";
import { useActionState, useContext, useState } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import { isTenantCommentMode } from "#lib/tenant-comment-mode-shared";
import type { TenantCommentMode } from "#lib/tenant-comment-mode-shared";
import { useTenantId } from "#lib/use-tenant-id";

import type { TenantCommentModeActionState } from "../settings-types";

interface TenantCommentModeFormProps {
  action: (
    prevState: TenantCommentModeActionState,
    formData: FormData
  ) => Promise<TenantCommentModeActionState>;
  canEdit: boolean;
  /** The saved value, absent when the settings read failed. */
  initialCommentMode?: TenantCommentMode;
  loadErrorMessage?: string;
}

/**
 * The three modes in the order the card offers them: off, then the two ways of
 * being on. Each key is written out rather than built from the mode, so the
 * catalog checks it.
 */
const commentModeItems = (messages: SharedMessages, disabled: boolean) => [
  {
    description: getMessage(
      messages,
      "admin.settings.comment_mode.options.disabled.description"
    ),
    disabled,
    label: getMessage(
      messages,
      "admin.settings.comment_mode.options.disabled.label"
    ),
    value: "disabled",
  },
  {
    description: getMessage(
      messages,
      "admin.settings.comment_mode.options.immediate.description"
    ),
    disabled,
    label: getMessage(
      messages,
      "admin.settings.comment_mode.options.immediate.label"
    ),
    value: "immediate",
  },
  {
    description: getMessage(
      messages,
      "admin.settings.comment_mode.options.approval_required.description"
    ),
    disabled,
    label: getMessage(
      messages,
      "admin.settings.comment_mode.options.approval_required.label"
    ),
    value: "approval_required",
  },
];

export const TenantCommentModeForm = ({
  action,
  canEdit,
  initialCommentMode,
  loadErrorMessage,
}: TenantCommentModeFormProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [commentMode, setCommentMode] = useState(initialCommentMode);

  // A failed read leaves the card with no saved mode to show, so saving from
  // that state would overwrite the tenant's live policy with whatever happened
  // to be picked — turning commenting off for a tenant that had it on, or on
  // for one that had it off. Editing stays closed until the read succeeds.
  const hasLoadError = Boolean(loadErrorMessage);
  const fieldsDisabled = !canEdit || hasLoadError;

  // The options close while the save is in flight as well. The Action carries
  // the mode the form held when it was submitted, so a pick made in the
  // meantime would sit selected under "How comments are published was saved."
  // while the tenant is on the other one.
  const optionsDisabled = fieldsDisabled || isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {getMessage(messages, "admin.settings.comment_mode.title")}
        </CardTitle>
        <CardDescription>
          {getMessage(messages, "admin.settings.comment_mode.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4 sm:max-w-lg">
          <input name="tenant_id" type="hidden" value={tenantId} />
          <input name="comment_mode" type="hidden" value={commentMode} />

          <Field>
            <FieldLabel htmlFor="tenant_comment_mode">
              {getMessage(messages, "admin.settings.comment_mode.label")}
            </FieldLabel>
            <FieldContent>
              <RadioGroup
                id="tenant_comment_mode"
                items={commentModeItems(messages, optionsDisabled)}
                onValueChange={(value) => {
                  if (isTenantCommentMode(value)) {
                    setCommentMode(value);
                  }
                }}
                value={commentMode}
              />
            </FieldContent>
          </Field>

          {canEdit ? null : (
            <FormMessage variant="destructive">
              {getMessage(messages, "admin.settings.admin_only")}
            </FormMessage>
          )}

          {loadErrorMessage ? (
            <FormMessage variant="destructive">
              <span className="block">{loadErrorMessage}</span>
              <span className="block">
                {getMessage(
                  messages,
                  "admin.settings.comment_mode.load_error_hint"
                )}
              </span>
            </FormMessage>
          ) : null}

          {state ? (
            <FormMessage variant={state.ok ? "success" : "destructive"}>
              {state.message}
            </FormMessage>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <Button disabled={fieldsDisabled || isPending} type="submit">
              {isPending
                ? getMessage(messages, "admin.settings.saving")
                : getMessage(messages, "admin.settings.comment_mode.submit")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
