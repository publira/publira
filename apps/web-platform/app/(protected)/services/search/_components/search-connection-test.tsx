"use client";

import {
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { FormMessage } from "@publira/ui-components/form-message";
import { useActionState } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";

import type { PlatformSearchTestState } from "../_lib/actions";

interface SearchConnectionTestProps {
  action: (
    prevState: PlatformSearchTestState,
    formData: FormData
  ) => Promise<PlatformSearchTestState>;
  disabled: boolean;
}

const PluginsMessage = ({
  plugins,
  pluginsListed,
}: {
  plugins: string[];
  pluginsListed: boolean;
}) => {
  if (!pluginsListed) {
    return <ClientMessage message="platform.search.test.plugins_unlisted" />;
  }
  if (plugins.length === 0) {
    return <ClientMessage message="platform.search.test.plugins_none" />;
  }
  return (
    <ClientMessage
      message="platform.search.test.plugins"
      values={{ plugins: plugins.join(", ") }}
    />
  );
};

/**
 * Runs the connection test with whatever the surrounding settings form holds,
 * saved or not, as a second submission of that form. An engine that answered
 * is shown with its version and the plugins every node has, so an operator
 * about to give a language a definition built on its plugin sees here whether
 * the engine can build it. None is required, so the list is information
 * rather than a verdict.
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
          <li className="flex items-start gap-2">
            <span className="size-4 shrink-0" />
            <span className="min-w-0 break-words text-foreground">
              <PluginsMessage
                plugins={result.plugins}
                pluginsListed={result.pluginsListed}
              />
            </span>
          </li>
        </ul>
      ) : null}
    </div>
  );
};
