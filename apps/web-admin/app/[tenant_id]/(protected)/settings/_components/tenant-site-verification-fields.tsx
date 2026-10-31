"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { createContext, use, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";
import type { TenantSiteVerification } from "#lib/tenant-site-verification";
import type { SiteVerificationService } from "#lib/tenant-site-verification-shared";
import {
  parseSiteVerificationCode,
  siteVerificationCodeMessage,
} from "#lib/tenant-site-verification-shared";

import type { TenantSiteVerificationActionState } from "../settings-types";

type SettledState = NonNullable<TenantSiteVerificationActionState>;

interface CodeFieldContextValue {
  value: string;
  /** Why the value cannot be saved, once the operator has left the field. */
  error: string | undefined;
  /** The key of the Action's `fieldErrors` the field's refusal comes under. */
  service: SiteVerificationService;
  setValue: (value: string) => void;
  /** Called as the operator leaves the field. */
  leave: () => void;
}

const CodeFieldContext = createContext<CodeFieldContextValue | null>(null);

const useCodeField = (): CodeFieldContextValue => {
  const context = use(CodeFieldContext);

  if (!context) {
    throw new Error("A code field slot must sit inside <CodeField>.");
  }

  return context;
};

/**
 * One service's code. Leaving the field reads it: a pasted `<meta>` element
 * is replaced with its `content` value, which is what a save sends, and a
 * value that is neither is named before the round trip.
 */
const CodeField = ({
  children,
  initialValue,
  service,
}: {
  children: ReactNode;
  initialValue: string;
  service: SiteVerificationService;
}) => {
  const t = useClientMessages();
  const [value, setValue] = useState(initialValue);
  const [touched, setTouched] = useState(false);
  const state = ActionForm.useState<SettledState>();
  const refused = state?.ok === false && state.fieldErrors?.[service];

  const result = parseSiteVerificationCode(service, value);

  const error =
    touched && !result.ok
      ? siteVerificationCodeMessage(t, service, result.reason)
      : undefined;

  const context = useMemo(
    () => ({
      error,
      leave: () => {
        const left = parseSiteVerificationCode(service, value);

        if (left.ok) {
          setValue(left.code);
        }

        setTouched(true);
      },
      service,
      setValue,
      value,
    }),
    [error, service, value]
  );

  return (
    <CodeFieldContext value={context}>
      <Field.Root invalid={error !== undefined || Boolean(refused)}>
        {children}
      </Field.Root>
    </CodeFieldContext>
  );
};

const CodeInput = ({ name }: { name: string }) => {
  const { leave, setValue, value } = useCodeField();

  return (
    <Input
      autoCapitalize="none"
      autoComplete="off"
      name={name}
      onBlur={leave}
      onChange={(event) => {
        setValue(event.target.value);
      }}
      spellCheck={false}
      value={value}
    />
  );
};

/**
 * The field's own reading of its value, or else what the server said about
 * it, so one message is never shown twice.
 */
const CodeError = () => {
  const { error, service } = useCodeField();

  return error === undefined ? (
    <ActionForm.FieldError name={service} />
  ) : (
    <FormMessage variant="destructive">{error}</FormMessage>
  );
};

interface TenantSiteVerificationFieldsProps {
  /** The saved codes, absent when they were not read. */
  initialSiteVerification?: TenantSiteVerification;
}

/**
 * The Google and Bing codes. A save answers them as the server stored them,
 * which is what the fields then hold.
 */
export const TenantSiteVerificationFields = ({
  initialSiteVerification,
}: TenantSiteVerificationFieldsProps) => {
  const [saved, setSaved] = useState<TenantSiteVerification>(
    () => initialSiteVerification ?? { bing: "", google: "" }
  );

  // Bumped by each save, which remounts the fields on what the server stored.
  const [savedCount, setSavedCount] = useState(0);

  ActionForm.useSettled<SettledState>((settled) => {
    if (!settled?.ok) {
      return;
    }

    setSaved(settled.siteVerification);
    setSavedCount((count) => count + 1);
  });

  return (
    <>
      <CodeField
        initialValue={saved.google}
        key={`google-${savedCount}`}
        service="google"
      >
        <Field.Label>
          <ClientMessage message="admin.settings.site_verification.google_label" />
        </Field.Label>
        <Field.Content>
          <CodeInput name="google_site_verification" />
          <CodeError />
          <Field.Description>
            <ClientMessage message="admin.settings.site_verification.google_description" />
          </Field.Description>
        </Field.Content>
      </CodeField>

      <CodeField
        initialValue={saved.bing}
        key={`bing-${savedCount}`}
        service="bing"
      >
        <Field.Label>
          <ClientMessage message="admin.settings.site_verification.bing_label" />
        </Field.Label>
        <Field.Content>
          <CodeInput name="bing_site_verification" />
          <CodeError />
          <Field.Description>
            <ClientMessage message="admin.settings.site_verification.bing_description" />
          </Field.Description>
        </Field.Content>
      </CodeField>
    </>
  );
};
