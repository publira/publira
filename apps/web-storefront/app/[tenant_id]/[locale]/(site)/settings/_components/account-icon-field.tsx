"use client";

import type { Locale } from "@publira/i18n";
import { UserIcon } from "@publira/icons";
import { Button } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { useRef, useState, useTransition } from "react";
import type { ChangeEvent } from "react";

import { AccountIcon } from "#components/account-icon";
import { ClientMessage, useClientMessages } from "#components/client-message";
import {
  ACCOUNT_ICON_CONTENT_TYPES,
  checkAccountIconImage,
} from "#lib/account-icon";
import type { AccountIconFileProblem } from "#lib/account-icon";
import type { AccountIcon as AccountIconValue } from "#lib/auth";
import type { StorefrontClientMessageKey } from "#lib/messages";

import { removeIconAction, uploadIconAction } from "../_lib/icon-actions";
import type { IconActionResult } from "../_lib/icon-actions";

const FILE_PROBLEM_MESSAGES: Record<
  AccountIconFileProblem,
  StorefrontClientMessageKey
> = {
  "too-large": "storefront.settings.icon_too_large",
  "too-small": "storefront.settings.icon_too_small",
  unsupported: "storefront.settings.icon_unsupported",
};

/**
 * The reader's icon on the settings screen: the icon or the stand-in for one,
 * a control that uploads a new one, and one that removes it.
 *
 * Each change is saved as soon as it is made rather than with the profile form
 * below it. The Action that saves it refreshes the account read, so the icon
 * here and the one in the header's account menu are both drawn again.
 */
export const AccountIconField = ({
  icon,
  locale,
  tenantId,
}: {
  icon: AccountIconValue | null;
  locale: Locale;
  tenantId: string;
}) => {
  const t = useClientMessages();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [outcome, setOutcome] = useState<IconActionResult | null>(null);
  const [action, setAction] = useState<"remove" | "upload" | null>(null);
  const [isPending, startTransition] = useTransition();

  const change = (
    next: "remove" | "upload",
    send: () => Promise<IconActionResult>,
    failed: string
  ) => {
    setAction(next);
    setOutcome(null);
    startTransition(async () => {
      try {
        setOutcome(await send());
      } catch {
        // An Action that never answered, or a failure it could not word. The
        // reader is told the one thing they can act on: try again.
        setOutcome({ message: failed, ok: false });
      }
    });
  };

  const formFor = () => {
    const body = new FormData();
    body.set("locale", locale);
    body.set("tenantId", tenantId);
    return body;
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    // Cleared so that picking the same file again, after a refusal, is still a
    // change the input reports.
    event.currentTarget.value = "";
    if (!file) {
      return;
    }

    change(
      "upload",
      async () => {
        const problem = await checkAccountIconImage(file);
        if (problem) {
          return { message: t(FILE_PROBLEM_MESSAGES[problem]), ok: false };
        }

        const body = formFor();
        body.set("icon", file);
        return uploadIconAction(body);
      },
      t("storefront.settings.icon_upload_failed")
    );
  };

  const onRemove = () => {
    change(
      "remove",
      () => removeIconAction(formFor()),
      t("storefront.settings.icon_remove_failed")
    );
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">
        <ClientMessage message="storefront.settings.icon_label" />
      </p>
      <div className="flex items-center gap-4">
        <AccountIcon
          alt={t("storefront.settings.icon_alt")}
          className="size-20 shrink-0 rounded-full border border-border object-cover"
          fallback={
            <span className="flex size-20 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
              <UserIcon
                aria-hidden="true"
                className="size-8 text-muted-foreground"
              />
            </span>
          }
          icon={icon}
          size={80}
        />
        <div className="flex flex-wrap gap-2">
          <input
            accept={ACCOUNT_ICON_CONTENT_TYPES.join(",")}
            aria-label={t(
              icon
                ? "storefront.settings.icon_replace"
                : "storefront.settings.icon_upload"
            )}
            className="hidden"
            onChange={onFileChange}
            ref={fileInputRef}
            type="file"
          />
          <Button
            disabled={isPending}
            onClick={() => fileInputRef.current?.click()}
            size="sm"
            type="button"
            variant="outline"
          >
            {isPending && action === "upload" ? (
              <ClientMessage message="storefront.settings.icon_uploading" />
            ) : (
              <ClientMessage
                message={
                  icon
                    ? "storefront.settings.icon_replace"
                    : "storefront.settings.icon_upload"
                }
              />
            )}
          </Button>
          {icon ? (
            <Button
              disabled={isPending}
              onClick={onRemove}
              size="sm"
              type="button"
              variant="ghost"
            >
              {isPending && action === "remove" ? (
                <ClientMessage message="storefront.settings.icon_removing" />
              ) : (
                <ClientMessage message="storefront.settings.icon_remove" />
              )}
            </Button>
          ) : null}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        <ClientMessage message="storefront.settings.icon_help" />
      </p>
      {outcome ? (
        <FormMessage variant={outcome.ok ? "success" : "destructive"}>
          {outcome.message}
        </FormMessage>
      ) : null}
    </div>
  );
};
