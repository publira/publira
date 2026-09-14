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
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Textarea } from "@publira/ui-components/textarea";
import { Suspense, useActionState, useCallback, useState } from "react";

import { useAdminMessages } from "#components/admin-locale-context";
import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { ClientMessage } from "#components/client-message";
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
  const t = useAdminMessages();
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
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.settings.site.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.settings.site.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <form action={formAction} className="grid gap-4">
        <input name="tenant_id" type="hidden" value={tenantId} />

        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.settings.site.copyright" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              name="copyright_text"
              onChange={handleCopyrightTextChange}
              placeholder={t("admin.settings.site.copyright_placeholder")}
              type="text"
              value={copyrightText}
            />
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <ClientMessage message="admin.settings.site.copyright_description" />
              </Suspense>
            </FieldDescription>
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.settings.site.tagline" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              name="site_tagline"
              onChange={handleSiteTaglineChange}
              placeholder={t("admin.settings.site.tagline_placeholder")}
              type="text"
              value={siteTagline}
            />
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <ClientMessage message="admin.settings.site.tagline_description" />
              </Suspense>
            </FieldDescription>
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.settings.site.site_description" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Textarea
              name="site_description"
              onChange={handleSiteDescriptionChange}
              placeholder={t(
                "admin.settings.site.site_description_placeholder"
              )}
              rows={3}
              value={siteDescription}
            />
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <ClientMessage message="admin.settings.site.site_description_description" />
              </Suspense>
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
