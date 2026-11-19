import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import { Badge } from "@publira/ui-components/badge";
import { Button, LinkButton } from "@publira/ui-components/button";
import * as Dialog from "@publira/ui-components/dialog";
import * as Field from "@publira/ui-components/field";
import { Fieldset } from "@publira/ui-components/fieldset";
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
import { verifyPlatformSession } from "#lib/auth-session";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getPlatformDisplayTimeZone } from "#lib/platform-settings";
import { isPlatformSuperAdmin } from "#lib/roles";
import { getTenantStatusLabel, getTenantStatusTone } from "#lib/tenant-labels";
import { getPlatformTenant } from "#lib/tenants";

import * as DeleteTenantDialog from "./_components/delete-tenant-dialog";
import { TenantSectionNav } from "./_components/tenant-section-nav";
import {
  deleteTenantAction,
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

/**
 * **Delete tenant**, and the dialog that asks for the tenant's name before it
 * marks the tenant for the worker to erase.
 */
const DeleteTenantForm = ({
  tenantId,
  tenantName,
}: {
  tenantId: string;
  tenantName: string;
}) => (
  <DeleteTenantDialog.Root name={tenantName}>
    <Dialog.Trigger
      render={<Button type="button" variant="destructiveFilled" />}
    >
      <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
        <Message message="platform.tenants.delete" />
      </Suspense>
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Backdrop />
      <Dialog.Viewport>
        <Dialog.Popup>
          <ActionForm.Root action={deleteTenantAction} className="grid gap-4">
            <DeleteTenantDialog.CloseOnSuccess />
            <input name="tenant_id" type="hidden" value={tenantId} />

            <Dialog.Header>
              <Dialog.Title className="text-lg font-semibold">
                <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                  <Message
                    message="platform.tenants.delete_title"
                    values={{ name: tenantName }}
                  />
                </Suspense>
              </Dialog.Title>
              <Dialog.Description className="grid gap-2 text-sm text-muted-foreground">
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  <span>
                    <Message message="platform.tenants.delete_description" />
                  </span>
                  <span>
                    <Message message="platform.tenants.delete_outside_note" />
                  </span>
                </Suspense>
              </Dialog.Description>
            </Dialog.Header>

            <Field.Root>
              <Field.Label required>
                <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                  <Message message="platform.tenants.delete_name_label" />
                </Suspense>
              </Field.Label>
              <Field.Content>
                <DeleteTenantDialog.NameInput />
              </Field.Content>
            </Field.Root>

            <Dialog.Footer>
              <Dialog.Close render={<Button type="button" variant="outline" />}>
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="platform.common.cancel" />
                </Suspense>
              </Dialog.Close>
              <DeleteTenantDialog.Submit>
                <ActionForm.Idle>
                  <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                    <Message message="platform.tenants.delete_action" />
                  </Suspense>
                </ActionForm.Idle>
                <ActionForm.Pending>
                  <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                    <Message message="platform.tenants.delete_pending" />
                  </Suspense>
                </ActionForm.Pending>
              </DeleteTenantDialog.Submit>
            </Dialog.Footer>
          </ActionForm.Root>
        </Dialog.Popup>
      </Dialog.Viewport>
    </Dialog.Portal>
  </DeleteTenantDialog.Root>
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

  const [t, tenantResult, timeZone, currentOperator] = await Promise.all([
    getMessagesFor(locale),
    getPlatformTenant(tenantId),
    getPlatformDisplayTimeZone(),
    verifyPlatformSession(),
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
  // A tenant being deleted answers as suspended until the worker has erased
  // it, and nothing about it can change any more: it is not resumed, and what
  // its forms would save is about to be erased.
  const isDeleting = tenant.status === "deleting";

  const canDelete =
    tenant.status === "suspended" && isPlatformSuperAdmin(currentOperator.role);

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
          {tenant.status === "suspended" || isDeleting ? (
            <form action={resumeTenantAction}>
              <input name="tenant_id" type="hidden" value={tenant.id} />
              <Button disabled={isDeleting} type="submit">
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
          {canDelete ? (
            <DeleteTenantForm tenantId={tenant.id} tenantName={tenant.name} />
          ) : null}
        </ConsolePage.Actions>
      </ConsolePage.Header>
      <ConsolePage.Content>
        <div className="grid gap-6">
          <TenantSectionNav current="detail" tenantId={tenant.publicId} />

          {isDeleting ? (
            <output className="grid gap-1 rounded-control border px-3 py-2">
              <p className="text-sm font-medium">
                {t("platform.tenants.deleting_notice_title")}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("platform.tenants.deleting_notice")}
              </p>
            </output>
          ) : null}

          <Fieldset disabled={isDeleting}>
            <ConsoleSection.Stack>
              <ConsoleSection.Root>
                <ConsoleSection.Header>
                  <ConsoleSection.Heading>
                    <ConsoleSection.Title>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-32" />}
                      >
                        <Message message="platform.tenants.basic_title" />
                      </Suspense>
                    </ConsoleSection.Title>
                    <ConsoleSection.Description>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-32" />}
                      >
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
                        <Badge tone={tenantStatusTone}>
                          {tenantStatusLabel}
                        </Badge>
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
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-32" />}
                      >
                        <Message message="platform.tenants.domain_settings_title" />
                      </Suspense>
                    </ConsoleSection.Title>
                    <ConsoleSection.Description>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-32" />}
                      >
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
          </Fieldset>
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
