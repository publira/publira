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

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { ClientMessage, useClientMessages } from "#components/client-message";
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
  const t = useClientMessages();
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const [copyrightText, setCopyrightText] = useState(
    initialSettings.copyrightText
  );
  const [siteDescription, setSiteDescription] = useState(
    initialSettings.siteDescription
  );
  const [siteTagline, setSiteTagline] = useState(initialSettings.siteTagline);

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
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <ClientMessage message="admin.settings.site.title" />
          </AdminSectionTitle>
          <AdminSectionDescription>
            <ClientMessage message="admin.settings.site.description" />
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <form action={formAction} className="grid gap-4">
        <input name="tenant_id" type="hidden" value={tenantId} />

        <Field>
          <FieldLabel>
            <ClientMessage message="admin.settings.site.copyright" />
          </FieldLabel>
          <FieldContent>
            <Input
              disabled={isPending}
              name="copyright_text"
              onChange={handleCopyrightTextChange}
              placeholder={t("admin.settings.site.copyright_placeholder")}
              type="text"
              value={copyrightText}
            />
            <FieldDescription>
              <ClientMessage message="admin.settings.site.copyright_description" />
            </FieldDescription>
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel>
            <ClientMessage message="admin.settings.site.tagline" />
          </FieldLabel>
          <FieldContent>
            <Input
              disabled={isPending}
              name="site_tagline"
              onChange={handleSiteTaglineChange}
              placeholder={t("admin.settings.site.tagline_placeholder")}
              type="text"
              value={siteTagline}
            />
            <FieldDescription>
              <ClientMessage message="admin.settings.site.tagline_description" />
            </FieldDescription>
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel>
            <ClientMessage message="admin.settings.site.site_description" />
          </FieldLabel>
          <FieldContent>
            <Textarea
              disabled={isPending}
              name="site_description"
              onChange={handleSiteDescriptionChange}
              placeholder={t(
                "admin.settings.site.site_description_placeholder"
              )}
              rows={3}
              value={siteDescription}
            />
            <FieldDescription>
              <ClientMessage message="admin.settings.site.site_description_description" />
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
              ? t("admin.settings.saving")
              : t("admin.settings.site.submit")}
          </Button>
        </div>
      </form>
    </AdminSection>
  );
};
