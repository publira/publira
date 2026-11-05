"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import * as Identifier from "@publira/ui-components/identifier";
import type { ReactNode } from "react";

import type { IssuedSecretFormState } from "../api-keys-and-webhooks-types";

/**
 * The key or signing secret the surrounding form's Action answered, at the one
 * moment it leaves the server. It is held only in that form's state, so it
 * stays on screen until the form is submitted again or the page is left, and
 * nothing can bring it back afterwards.
 *
 * Renders nothing until the Action succeeds. The heading and the warning are
 * the caller's slots; the value and its copy control come from the state.
 */
const IssuedSecret = ({ children }: { children: ReactNode }) => {
  const state = ActionForm.useState<NonNullable<IssuedSecretFormState>>();

  if (!state?.ok || !("secret" in state) || !state.secret) {
    return null;
  }

  return (
    <div className="grid gap-3 border border-border bg-muted/40 p-4">
      {children}
    </div>
  );
};

const IssuedSecretTitle = ({ children }: { children: ReactNode }) => (
  <p className="text-sm font-medium text-foreground">{children}</p>
);

const IssuedSecretDescription = ({ children }: { children: ReactNode }) => (
  <p className="text-xs text-muted-foreground">{children}</p>
);

/** The value itself, with a control that copies it. */
const IssuedSecretValue = ({
  "aria-label": ariaLabel,
}: {
  /** Names what the copy control copies. */
  "aria-label": string;
}) => {
  const state = ActionForm.useState<NonNullable<IssuedSecretFormState>>();
  const secret = state?.ok && "secret" in state ? state.secret : "";

  return secret ? (
    <Identifier.Root>
      <Identifier.Value>{secret}</Identifier.Value>
      <Identifier.Copy aria-label={ariaLabel} value={secret} />
    </Identifier.Root>
  ) : null;
};

export {
  IssuedSecret as Root,
  IssuedSecretDescription as Description,
  IssuedSecretTitle as Title,
  IssuedSecretValue as Value,
};
