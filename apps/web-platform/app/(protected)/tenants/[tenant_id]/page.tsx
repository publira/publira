import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import { Badge } from "@publira/ui-components/badge";
import { Button, LinkButton } from "@publira/ui-components/button";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import * as SectionError from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTime } from "@publira/utils";
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
import { ImageDomainPreview } from "#components/image-domain-preview";
import { Message } from "#components/message";
import { TenantDomainCautions } from "#components/tenant-domain-cautions";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getPlatformDisplayTimeZone } from "#lib/platform-settings";
import { getTenantStatusLabel, getTenantStatusTone } from "#lib/tenant-labels";
import { getPlatformTenant } from "#lib/tenants";

import { TenantSectionNav } from "./_components/tenant-section-nav";
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
  const t = await getMessagesFor(locale);
  const parsedParams = parseRouteParams(tenantDetailParamsSchema, await params);
  if (!parsedParams) {
    return { title: t("platform.tenants.heading") };
  }

  const tenantResult = await getPlatformTenant(parsedParams.tenant_id);
  const name =
    tenantResult.ok && tenantResult.tenant ? tenantResult.tenant.name : "";

  return {
    title: name
      ? t("platform.tenants.detail_title", { name })
      : t("platform.tenants.heading"),
  };
};

const TenantDetailSkeleton = () => (
  <ConsolePage.Content>
    <div className="grid gap-6">
      <Skeleton className="h-10 w-64" />
      <ConsoleSection.Stack>
        <ConsoleSection.Root>
          <SkeletonLine className="h-5 w-40" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </ConsoleSection.Root>
        <ConsoleSection.Root>
          <SkeletonLine className="h-5 w-40" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </ConsoleSection.Root>
      </ConsoleSection.Stack>
    </div>
  </ConsolePage.Content>
);

/**
 * A read that failed is not a tenant that is missing. Collapsing the two into
 * `notFound()` would tell the operator to stop looking for a tenant that is
 * still there, so an outage keeps the console's own wording and a way back.
 */
const TenantLoadError = ({ message }: { message: string }) => (
  <SectionError.Root>
    <SectionError.Heading>
      <SectionError.Title>
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message="platform.tenants.load_one_failed" />
        </Suspense>
      </SectionError.Title>
      <SectionError.Description>{message}</SectionError.Description>
    </SectionError.Heading>
    <SectionError.Actions>
      <LinkButton render={<Link href="/tenants" />} variant="outline">
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="platform.common.back_to_list" />
        </Suspense>
      </LinkButton>
    </SectionError.Actions>
  </SectionError.Root>
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

  const [t, tenantResult, timeZone] = await Promise.all([
    getMessagesFor(locale),
    getPlatformTenant(tenantId),
    getPlatformDisplayTimeZone(),
  ]);

  if (!tenantResult.ok) {
    return <TenantLoadError message={tenantResult.message} />;
  }

  const { tenant } = tenantResult;
  if (!tenant) {
    notFound();
  }
  const tenantStatusLabel = await getTenantStatusLabel(tenant.status, locale);
  const tenantStatusTone = getTenantStatusTone(tenant.status);
  const saveLabel = t("platform.common.save");
  const savingLabel = t("platform.common.saving");

  return (
    <>
      <ConsolePage.Header>
        <ConsolePage.Heading>
          <ConsolePage.Title>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message
                message="platform.tenants.detail_title"
                values={{
                  name: tenant.name,
                }}
              />
            </Suspense>
          </ConsolePage.Title>
          <ConsolePage.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.tenants.detail_description" />
            </Suspense>
          </ConsolePage.Description>
        </ConsolePage.Heading>
        <ConsolePage.Actions>
          <LinkButton render={<Link href="/tenants" />} variant="outline">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.common.back_to_list" />
            </Suspense>
          </LinkButton>
          <LinkButton
            render={
              <Link
                href={`/audit-logs?tenant_id=${encodeURIComponent(tenant.publicId)}`}
              />
            }
            variant="outline"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="platform.tenants.update_audit" />
            </Suspense>
          </LinkButton>
          {tenant.status === "suspended" ? (
            <form action={resumeTenantAction}>
              <input name="tenant_id" type="hidden" value={tenant.id} />
              <Button type="submit">
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="platform.tenants.resume" />
                </Suspense>
              </Button>
            </form>
          ) : (
            <form action={suspendTenantAction}>
              <input name="tenant_id" type="hidden" value={tenant.id} />
              <Button type="submit" variant="destructive">
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="platform.tenants.suspend" />
                </Suspense>
              </Button>
            </form>
          )}
        </ConsolePage.Actions>
      </ConsolePage.Header>
      <ConsolePage.Content>
        <div className="grid gap-6">
          <TenantSectionNav current="detail" tenantId={tenant.publicId} />

          <ConsoleSection.Stack>
            <ConsoleSection.Root>
              <ConsoleSection.Header>
                <ConsoleSection.Heading>
                  <ConsoleSection.Title>
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <Message message="platform.tenants.basic_title" />
                    </Suspense>
                  </ConsoleSection.Title>
                  <ConsoleSection.Description>
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <Message message="platform.tenants.basic_description" />
                    </Suspense>
                  </ConsoleSection.Description>
                </ConsoleSection.Heading>
              </ConsoleSection.Header>
              <ActionForm.Root action={updateTenantNameAction}>
                <input name="tenant_id" type="hidden" value={tenant.id} />
                <div className="grid gap-4">
                  <Field.Root>
                    <Field.Label required>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-32" />}
                      >
                        <Message message="platform.tenants.name" />
                      </Suspense>
                    </Field.Label>
                    <Input
                      key={tenant.name}
                      defaultValue={tenant.name}
                      name="tenant_name"
                      required
                      type="text"
                    />
                  </Field.Root>
                  <Field.Root>
                    <Field.Label>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-32" />}
                      >
                        <Message message="platform.common.created_at" />
                      </Suspense>
                    </Field.Label>
                    <p className="text-sm">
                      {formatDateTime(tenant.createdAt, {
                        fallback: t("platform.common.unset"),
                        locale,
                        timeZone,
                      })}
                    </p>
                  </Field.Root>
                  <Field.Root>
                    <Field.Label>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-32" />}
                      >
                        <Message message="platform.common.status" />
                      </Suspense>
                    </Field.Label>
                    <p>
                      <Badge tone={tenantStatusTone}>{tenantStatusLabel}</Badge>
                    </p>
                  </Field.Root>
                </div>
                <ActionForm.Submit
                  className="mt-4 ml-auto block"
                  variant="outline"
                >
                  <ActionForm.Idle>{saveLabel}</ActionForm.Idle>
                  <ActionForm.Pending>{savingLabel}</ActionForm.Pending>
                </ActionForm.Submit>
              </ActionForm.Root>
            </ConsoleSection.Root>

            <ConsoleSection.Root>
              <ConsoleSection.Header>
                <ConsoleSection.Heading>
                  <ConsoleSection.Title>
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <Message message="platform.tenants.domain_settings_title" />
                    </Suspense>
                  </ConsoleSection.Title>
                  <ConsoleSection.Description>
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <Message message="platform.tenants.domain_settings_description" />
                    </Suspense>
                  </ConsoleSection.Description>
                </ConsoleSection.Heading>
              </ConsoleSection.Header>
              <TenantDomainCautions showUpdateCaution />
              <ActionForm.Root action={updateTenantDomainAction}>
                <input name="tenant_id" type="hidden" value={tenant.id} />
                <div className="grid gap-4">
                  <Field.Root>
                    <Field.Label required>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-32" />}
                      >
                        <Message message="platform.tenants.domain" />
                      </Suspense>
                    </Field.Label>
                    <Input
                      key={tenant.domain}
                      defaultValue={tenant.domain}
                      name="tenant_domain"
                      placeholder="tenant-example.example.com"
                      required
                      type="text"
                    />
                  </Field.Root>
                  <Field.Root>
                    <Field.Label>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-32" />}
                      >
                        <Message message="platform.tenants.admin_domain" />
                      </Suspense>
                    </Field.Label>
                    <Input
                      key={tenant.adminDomain}
                      defaultValue={tenant.adminDomain}
                      name="tenant_admin_domain"
                      placeholder={`admin.${tenant.domain}`}
                      type="text"
                    />
                    <AdminDomainPreview
                      adminDomain={tenant.adminDomain}
                      domain={tenant.domain}
                      showCurrentDomain
                    />
                  </Field.Root>
                  <Field.Root>
                    <Field.Label>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-24" />}
                      >
                        <Message message="platform.tenants.image_domain" />
                      </Suspense>
                    </Field.Label>
                    <Input
                      key={tenant.imageDomain}
                      defaultValue={tenant.imageDomain}
                      name="tenant_image_domain"
                      type="text"
                    />
                    <ImageDomainPreview
                      domain={tenant.domain}
                      imageDomain={tenant.imageDomain}
                    />
                  </Field.Root>
                </div>
                <ActionForm.Submit
                  className="mt-4 ml-auto block"
                  variant="outline"
                >
                  <ActionForm.Idle>{saveLabel}</ActionForm.Idle>
                  <ActionForm.Pending>{savingLabel}</ActionForm.Pending>
                </ActionForm.Submit>
              </ActionForm.Root>
            </ConsoleSection.Root>
          </ConsoleSection.Stack>
        </div>
      </ConsolePage.Content>
    </>
  );
};

// `ConsolePage.Root` stays in the static shell so the max width and padding are
// painted before `params` resolves; only the header and body stream in.
const TenantDetailPage = ({ params }: TenantDetailPageProps) => (
  <ConsolePage.Root>
    <Suspense fallback={<TenantDetailSkeleton />}>
      <TenantDetailContent params={params} />
    </Suspense>
  </ConsolePage.Root>
);

export default TenantDetailPage;
