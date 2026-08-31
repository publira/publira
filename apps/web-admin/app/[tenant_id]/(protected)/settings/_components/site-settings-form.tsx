"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { Textarea } from "@publira/ui-components/textarea";
import { useActionState, useCallback, useContext, useState } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import type { TenantSiteSettings } from "#lib/site-settings";
import { useTenantId } from "#lib/use-tenant-id";

import type { SiteSettingsActionState } from "../settings-types";

interface SiteSettingsFormProps {
  action: (
    prevState: SiteSettingsActionState,
    formData: FormData
  ) => Promise<SiteSettingsActionState>;
  initialSettings: TenantSiteSettings;
}

export const SiteSettingsForm = ({
  action,
  initialSettings,
}: SiteSettingsFormProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [copyrightText, setCopyrightText] = useState(
    initialSettings.copyrightText
  );
  const [siteDescription, setSiteDescription] = useState(
    initialSettings.siteDescription
  );
  const [siteTagline, setSiteTagline] = useState(initialSettings.siteTagline);
  const [prevCopyrightText, setPrevCopyrightText] = useState(
    initialSettings.copyrightText
  );
  const [prevSiteDescription, setPrevSiteDescription] = useState(
    initialSettings.siteDescription
  );
  const [prevSiteTagline, setPrevSiteTagline] = useState(
    initialSettings.siteTagline
  );

  if (
    initialSettings.copyrightText !== prevCopyrightText ||
    initialSettings.siteDescription !== prevSiteDescription ||
    initialSettings.siteTagline !== prevSiteTagline
  ) {
    setPrevCopyrightText(initialSettings.copyrightText);
    setPrevSiteDescription(initialSettings.siteDescription);
    setPrevSiteTagline(initialSettings.siteTagline);
    setCopyrightText(initialSettings.copyrightText);
    setSiteDescription(initialSettings.siteDescription);
    setSiteTagline(initialSettings.siteTagline);
  }

  const handleCopyrightTextChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setCopyrightText(event.target.value);
    },
    []
  );

  const handleSiteDescriptionChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setSiteDescription(event.target.value);
    },
    []
  );

  const handleSiteTaglineChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setSiteTagline(event.target.value);
    },
    []
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {getMessage(messages, "admin.settings.site.title")}
        </CardTitle>
        <CardDescription>
          {getMessage(messages, "admin.settings.site.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4">
          <input name="tenant_id" type="hidden" value={tenantId} />

          <Field>
            <FieldLabel>
              {getMessage(messages, "admin.settings.site.copyright")}
            </FieldLabel>
            <FieldContent>
              <Input
                name="copyright_text"
                onChange={handleCopyrightTextChange}
                placeholder={getMessage(
                  messages,
                  "admin.settings.site.copyright_placeholder"
                )}
                type="text"
                value={copyrightText}
              />
              <FieldDescription>
                {getMessage(
                  messages,
                  "admin.settings.site.copyright_description"
                )}
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>
              {getMessage(messages, "admin.settings.site.tagline")}
            </FieldLabel>
            <FieldContent>
              <Input
                name="site_tagline"
                onChange={handleSiteTaglineChange}
                placeholder={getMessage(
                  messages,
                  "admin.settings.site.tagline_placeholder"
                )}
                type="text"
                value={siteTagline}
              />
              <FieldDescription>
                {getMessage(
                  messages,
                  "admin.settings.site.tagline_description"
                )}
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>
              {getMessage(messages, "admin.settings.site.site_description")}
            </FieldLabel>
            <FieldContent>
              <Textarea
                name="site_description"
                onChange={handleSiteDescriptionChange}
                placeholder={getMessage(
                  messages,
                  "admin.settings.site.site_description_placeholder"
                )}
                rows={3}
                value={siteDescription}
              />
              <FieldDescription>
                {getMessage(
                  messages,
                  "admin.settings.site.site_description_description"
                )}
              </FieldDescription>
            </FieldContent>
          </Field>

          {state ? (
            <FormMessage variant={state.ok ? "success" : "destructive"}>
              {state.message}
            </FormMessage>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <Button disabled={isPending} type="submit">
              {isPending
                ? getMessage(messages, "admin.settings.saving")
                : getMessage(messages, "admin.settings.site.submit")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
