"use client";

import { CheckIcon, CloseIcon } from "@publira/icons";
import {
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { FormMessage } from "@publira/ui-components/form-message";
import { cn } from "@publira/utils";
import { useActionState } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";
import {
  SEARCH_PLUGIN_ICU,
  SEARCH_PLUGIN_KUROMOJI,
} from "#lib/search-settings-shared";

import type { PlatformSearchTestState } from "../_lib/actions";

interface SearchConnectionTestProps {
  action: (
    prevState: PlatformSearchTestState,
    formData: FormData
  ) => Promise<PlatformSearchTestState>;
  disabled: boolean;
}

const PluginCheck = ({
  installed,
  name,
}: {
  installed: boolean;
  name: string;
}) => (
  <li className="flex items-start gap-2">
    <span
      className={cn(
        "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center",
        installed ? "text-success" : "text-destructive"
      )}
    >
      {installed ? (
        <CheckIcon aria-hidden className="size-4" />
      ) : (
        <CloseIcon aria-hidden className="size-4" />
      )}
    </span>
    <span className="font-medium text-foreground">
      {name}
      {": "}
      {installed ? (
        <ClientMessage message="platform.search.test.installed" />
      ) : (
        <ClientMessage message="platform.search.test.missing" />
      )}
    </span>
  </li>
);

/**
 * Runs the connection test with whatever the surrounding settings form holds,
 * saved or not, as a second submission of that form. An engine that answered
 * is shown with its version and both plugins, so a missing plugin is named
 * here rather than by the first index build.
 */
export const SearchConnectionTest = ({
  action,
  disabled,
}: SearchConnectionTestProps) => {
  const [state, dispatch] = useActionState(action, null);
  const t = useClientMessages();
  const result = state?.result;

  return (
    <div className="grid gap-3 rounded-control border border-border p-4">
      <div className="grid gap-1">
        <p className="text-sm font-medium text-foreground">
          <ClientMessage message="platform.search.test.title" />
        </p>
        <p className="text-xs text-muted-foreground">
          <ClientMessage message="platform.search.test.description" />
        </p>
      </div>
      <div>
        <ActionFormSubmit
          disabled={disabled}
          formAction={dispatch}
          variant="outline"
        >
          <ActionFormIdle>
            <ClientMessage message="platform.search.test.submit" />
          </ActionFormIdle>
          <ActionFormPending>
            <ClientMessage message="platform.search.test.pending" />
          </ActionFormPending>
        </ActionFormSubmit>
      </div>
      {state ? (
        <FormMessage variant={state.ok ? "success" : "destructive"}>
          {state.message}
        </FormMessage>
      ) : null}
      {result?.product ? (
        <ul
          aria-label={t("platform.search.test.results")}
          className="grid gap-2 text-sm"
        >
          <li className="flex items-start gap-2">
            <span className="size-4 shrink-0" />
            <span className="font-medium text-foreground">
              <ClientMessage
                message="platform.search.test.engine"
                values={{
                  product: result.product,
                  version: result.version,
                }}
              />
            </span>
          </li>
          <PluginCheck
            installed={result.kuromojiInstalled}
            name={SEARCH_PLUGIN_KUROMOJI}
          />
          <PluginCheck
            installed={result.icuInstalled}
            name={SEARCH_PLUGIN_ICU}
          />
        </ul>
      ) : null}
    </div>
  );
};
