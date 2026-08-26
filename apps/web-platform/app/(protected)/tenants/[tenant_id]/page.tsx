import { Badge } from "@publira/ui-components/badge";
import { Button, LinkButton } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { Field, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SectionError } from "@publira/ui-components/section-error";
import { formatDateTime } from "@publira/utils";
import { getMessage } from "@publira/utils/i18n";
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { AdminDomainPreview } from "#components/admin-domain-preview";
import {
  PlatformPage,
  PlatformPageActions,
  PlatformPageContent,
  PlatformPageDescription,
  PlatformPageEyebrow,
  PlatformPageHeader,
  PlatformPageHeading,
  PlatformPageTitle,
} from "#components/platform-page";
import { TenantDomainCautions } from "#components/tenant-domain-cautions";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getPlatformLocale, loadPlatformMessages } from "#lib/locale";
import type { PlatformMessages } from "#lib/locale";
import { getPlatformDisplayTimeZone } from "#lib/platform-settings";
import { getTenantStatusLabel, getTenantStatusTone } from "#lib/tenant-labels";
import { getPlatformTenant } from "#lib/tenants";

import { TenantSectionNav } from "./_components/tenant-section-nav";
import { TenantUpdateForm } from "./_components/tenant-update-form";
import {
  resumeTenantAction,
  suspendTenantAction,
  updateTenantDomainAction,
  updateTenantNameAction,
} from "./_lib/actions";

interface TenantDetailPageProps {
  params: Promise<{
    tenant_id: string;
  }>;
}

const tenantDetailParamsSchema = z.object({
  tenant_id: routeParamString(),
});

export const generateMetadata = async ({
  params,
}: TenantDetailPageProps): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const messages = await loadPlatformMessages(locale);
  const parsedParams = parseRouteParams(tenantDetailParamsSchema, await params);
  if (!parsedParams) {
    return { title: getMessage(messages, "platform.tenants.heading") };
  }

  const tenantResult = await getPlatformTenant(parsedParams.tenant_id, locale);
  const name =
    tenantResult.ok && tenantResult.tenant ? tenantResult.tenant.name : "";

  return {
    title: name
      ? getMessage(messages, "platform.tenants.detail_title", { name })
      : getMessage(messages, "platform.tenants.heading"),
  };
};

const TenantDetailSkeleton = () => (
  <PlatformPageContent>
    <div className="grid gap-6">
      <div className="h-10 w-64 animate-pulse rounded bg-muted/70" />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <div className="h-5 w-28 animate-pulse rounded bg-muted" />
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              <div className="h-16 animate-pulse rounded bg-muted/70" />
              <div className="h-16 animate-pulse rounded bg-muted/70" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="h-5 w-32 animate-pulse rounded bg-muted" />
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              <div className="h-16 animate-pulse rounded bg-muted/70" />
              <div className="h-16 animate-pulse rounded bg-muted/70" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  </PlatformPageContent>
);

/**
 * A read that failed is not a tenant that is missing. Collapsing the two into
 * `notFound()` would tell the operator to stop looking for a tenant that is
 * still there, so an outage keeps the console's own wording and a way back.
 */
const TenantLoadError = ({
  messages,
  message,
}: {
  message: string;
  messages: PlatformMessages;
}) => (
  <SectionError
    actions={
      <LinkButton render={<Link href="/tenants" />} variant="outline">
        {getMessage(messages, "platform.common.back_to_list")}
      </LinkButton>
    }
    description={message}
    title={getMessage(messages, "platform.tenants.load_one_failed")}
  />
);

const TenantDetailContent = async ({
  params,
}: Pick<TenantDetailPageProps, "params">) => {
  const parsedParams = parseRouteParams(tenantDetailParamsSchema, await params);
  if (!parsedParams) {
    notFound();
  }
  const { tenant_id: tenantId } = parsedParams;
  const locale = await getPlatformLocale();

  const [messages, tenantResult, timeZone] = await Promise.all([
    loadPlatformMessages(locale),
    getPlatformTenant(tenantId, locale),
    getPlatformDisplayTimeZone(),
  ]);

  // Before both branches below: a rejected session reads every record as
  // missing, and a 404 would hide that the operator only needs to sign in again.
  await redirectToLoginIfSessionRejected(tenantResult);

  if (!tenantResult.ok) {
    return (
      <TenantLoadError message={tenantResult.message} messages={messages} />
    );
  }

  const { tenant } = tenantResult;
  if (!tenant) {
    notFound();
  }
  const tenantStatusLabel = getTenantStatusLabel(tenant.status, messages);
  const tenantStatusTone = getTenantStatusTone(tenant.status);
  const saveLabel = getMessage(messages, "platform.common.save");
  const savingLabel = getMessage(messages, "platform.common.saving");

  return (
    <>
      <PlatformPageHeader>
        <PlatformPageHeading>
          <PlatformPageEyebrow>Platform Tenants</PlatformPageEyebrow>
          <PlatformPageTitle>
            {getMessage(messages, "platform.tenants.detail_title", {
              name: tenant.name,
            })}
          </PlatformPageTitle>
          <PlatformPageDescription>
            {getMessage(messages, "platform.tenants.detail_description")}
          </PlatformPageDescription>
        </PlatformPageHeading>
        <PlatformPageActions>
          <LinkButton render={<Link href="/tenants" />} variant="outline">
            {getMessage(messages, "platform.common.back_to_list")}
          </LinkButton>
          <LinkButton
            render={
              <Link
                href={`/audit-logs?tenant_id=${encodeURIComponent(tenant.publicId)}`}
              />
            }
            variant="outline"
          >
            {getMessage(messages, "platform.tenants.update_audit")}
          </LinkButton>
          {tenant.status === "suspended" ? (
            <form action={resumeTenantAction}>
              <input name="tenant_id" type="hidden" value={tenant.publicId} />
              <Button type="submit">
                {getMessage(messages, "platform.tenants.resume")}
              </Button>
            </form>
          ) : (
            <form action={suspendTenantAction}>
              <input name="tenant_id" type="hidden" value={tenant.publicId} />
              <Button type="submit" variant="destructive">
                {getMessage(messages, "platform.tenants.suspend")}
              </Button>
            </form>
          )}
        </PlatformPageActions>
      </PlatformPageHeader>
      <PlatformPageContent>
        <div className="grid gap-6">
          <TenantSectionNav
            current="detail"
            labels={{
              basic: getMessage(messages, "platform.tenants.section_basic"),
              members: getMessage(messages, "platform.tenants.members_nav"),
            }}
            tenantId={tenant.publicId}
          />

          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>
                  {getMessage(messages, "platform.tenants.basic_title")}
                </CardTitle>
                <CardDescription>
                  {getMessage(messages, "platform.tenants.basic_description")}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <TenantUpdateForm
                  action={updateTenantNameAction}
                  pendingLabel={savingLabel}
                  submitLabel={saveLabel}
                >
                  <input
                    name="tenant_id"
                    type="hidden"
                    value={tenant.publicId}
                  />
                  <input
                    name="tenant_current_domain"
                    type="hidden"
                    value={tenant.domain}
                  />
                  <div className="grid gap-4">
                    <Field>
                      <FieldLabel required>
                        {getMessage(messages, "platform.tenants.name")}
                      </FieldLabel>
                      <Input
                        key={tenant.name}
                        defaultValue={tenant.name}
                        name="tenant_name"
                        required
                        type="text"
                      />
                    </Field>
                    <Field>
                      <FieldLabel>
                        {getMessage(messages, "platform.common.created_at")}
                      </FieldLabel>
                      <p className="text-sm">
                        {formatDateTime(tenant.createdAt, {
                          fallback: getMessage(
                            messages,
                            "platform.common.unset"
                          ),
                          locale,
                          timeZone,
                        })}
                      </p>
                    </Field>
                    <Field>
                      <FieldLabel>
                        {getMessage(messages, "platform.common.status")}
                      </FieldLabel>
                      <p>
                        <Badge tone={tenantStatusTone}>
                          {tenantStatusLabel}
                        </Badge>
                      </p>
                    </Field>
                  </div>
                </TenantUpdateForm>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  {getMessage(
                    messages,
                    "platform.tenants.domain_settings_title"
                  )}
                </CardTitle>
                <CardDescription>
                  {getMessage(
                    messages,
                    "platform.tenants.domain_settings_description"
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <TenantDomainCautions
                  copy={{
                    items: [
                      getMessage(messages, "platform.tenants.caution_cache"),
                      getMessage(messages, "platform.tenants.caution_unique"),
                      getMessage(messages, "platform.tenants.caution_dns"),
                      getMessage(messages, "platform.tenants.caution_update"),
                    ],
                    title: getMessage(
                      messages,
                      "platform.tenants.caution_title"
                    ),
                  }}
                />
                <TenantUpdateForm
                  action={updateTenantDomainAction}
                  pendingLabel={savingLabel}
                  submitLabel={saveLabel}
                >
                  <input
                    name="tenant_id"
                    type="hidden"
                    value={tenant.publicId}
                  />
                  <input
                    name="tenant_current_name"
                    type="hidden"
                    value={tenant.name}
                  />
                  <div className="grid gap-4">
                    <Field>
                      <FieldLabel required>
                        {getMessage(messages, "platform.tenants.domain")}
                      </FieldLabel>
                      <Input
                        key={tenant.domain}
                        defaultValue={tenant.domain}
                        id="tenant_domain"
                        name="tenant_domain"
                        placeholder="tenant-example.example.com"
                        required
                        type="text"
                      />
                    </Field>
                    <Field>
                      <FieldLabel>
                        {getMessage(messages, "platform.tenants.admin_domain")}
                      </FieldLabel>
                      <Input
                        key={tenant.adminDomain}
                        defaultValue={tenant.adminDomain}
                        id="tenant_admin_domain"
                        name="tenant_admin_domain"
                        placeholder={`admin.${tenant.domain}`}
                        type="text"
                      />
                      <AdminDomainPreview
                        adminDomain={tenant.adminDomain}
                        copy={{
                          current: getMessage(
                            messages,
                            "platform.tenants.admin_domain_preview_current"
                          ),
                          prefix: getMessage(
                            messages,
                            "platform.tenants.admin_domain_preview_prefix"
                          ),
                          set: getMessage(
                            messages,
                            "platform.tenants.admin_domain_preview_set"
                          ),
                        }}
                        domain={tenant.domain}
                        showCurrentDomain
                      />
                    </Field>
                  </div>
                </TenantUpdateForm>
              </CardContent>
            </Card>
          </div>
        </div>
      </PlatformPageContent>
    </>
  );
};

// `PlatformPage` stays in the static shell so the max width and padding are
// painted before `params` resolves; only the header and body stream in.
const TenantDetailPage = ({ params }: TenantDetailPageProps) => (
  <PlatformPage>
    <Suspense fallback={<TenantDetailSkeleton />}>
      <TenantDetailContent params={params} />
    </Suspense>
  </PlatformPage>
);

export default TenantDetailPage;
