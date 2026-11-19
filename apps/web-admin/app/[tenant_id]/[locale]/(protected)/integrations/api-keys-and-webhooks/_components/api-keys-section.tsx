import type { Locale } from "@publira/i18n";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { StatusChip } from "@publira/ui-components/badge";
import * as EmptyState from "@publira/ui-components/empty-state";
import { FormMessage } from "@publira/ui-components/form-message";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatDateTime } from "@publira/utils";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { ApiKeyItem } from "#lib/api-keys";

import { ApiKeyCreateForm } from "./api-key-create-form";
import { ApiKeyRevokeButton } from "./api-key-revoke-button";
import { ApiKeyScopeLabel } from "./api-key-scope-label";
import { TenantIdCopy } from "./tenant-id-copy";

interface ApiKeysSectionProps {
  apiKeys: ApiKeyItem[];
  loadErrorMessage?: string;
  locale: Locale;
  tenantId: string;
  timeZone: string;
}

const ApiKeyTable = ({
  apiKeys,
  locale,
  tenantId,
  timeZone,
}: Omit<ApiKeysSectionProps, "loadErrorMessage">) => (
  <Table.Root>
    <Table.Header>
      <Table.Row>
        <Table.Head>
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="admin.settings.api_keys.columns.name" />
          </Suspense>
        </Table.Head>
        <Table.Head>
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="admin.settings.api_keys.columns.prefix" />
          </Suspense>
        </Table.Head>
        <Table.Head>
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="admin.settings.api_keys.columns.scopes" />
          </Suspense>
        </Table.Head>
        <Table.Head className="w-44">
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.settings.api_keys.columns.created_at" />
          </Suspense>
        </Table.Head>
        <Table.Head className="w-44">
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.settings.api_keys.columns.last_used_at" />
          </Suspense>
        </Table.Head>
        <Table.Head className="w-28">
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="admin.settings.api_keys.columns.status" />
          </Suspense>
        </Table.Head>
        <Table.Head className="w-24">
          <span className="sr-only">
            <Suspense fallback={null}>
              <Message message="admin.settings.api_keys.columns.actions" />
            </Suspense>
          </span>
        </Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {apiKeys.map((apiKey) => (
        <Table.Row key={apiKey.id}>
          <Table.Cell className="font-medium">{apiKey.name}</Table.Cell>
          <Table.Cell className="tabular-nums">{apiKey.prefix}</Table.Cell>
          <Table.Cell>
            <span className="flex flex-wrap gap-1">
              {apiKey.scopes.map((scope) => (
                <StatusChip key={scope} status="muted" withIndicator={false}>
                  <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
                    <ApiKeyScopeLabel scope={scope} />
                  </Suspense>
                </StatusChip>
              ))}
            </span>
          </Table.Cell>
          <Table.Cell className="tabular-nums">
            {formatDateTime(apiKey.createdAt, { locale, timeZone })}
          </Table.Cell>
          <Table.Cell className="tabular-nums">
            {apiKey.lastUsedAt ? (
              formatDateTime(apiKey.lastUsedAt, { locale, timeZone })
            ) : (
              <span className="text-muted-foreground">
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.settings.api_keys.never_used" />
                </Suspense>
              </span>
            )}
          </Table.Cell>
          <Table.Cell>
            {apiKey.revokedAt ? (
              <StatusChip className="whitespace-nowrap" status="muted">
                <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
                  <Message message="admin.settings.api_keys.status_revoked" />
                </Suspense>
              </StatusChip>
            ) : (
              <StatusChip className="whitespace-nowrap" status="success">
                <Suspense fallback={<SkeletonLine className="h-4 w-14" />}>
                  <Message message="admin.settings.api_keys.status_active" />
                </Suspense>
              </StatusChip>
            )}
          </Table.Cell>
          <Table.Cell>
            {apiKey.revokedAt ? null : (
              <Suspense fallback={<SkeletonLine className="h-8 w-16" />}>
                <ApiKeyRevokeButton apiKey={apiKey} tenantId={tenantId} />
              </Suspense>
            )}
          </Table.Cell>
        </Table.Row>
      ))}
    </Table.Body>
  </Table.Root>
);

/** The tenant's keys, with what they may read, and the form that creates one. */
export const ApiKeysSection = ({
  apiKeys,
  loadErrorMessage,
  locale,
  tenantId,
  timeZone,
}: ApiKeysSectionProps) => (
  <ConsoleSection.Root>
    <ConsoleSection.Header>
      <ConsoleSection.Heading>
        <ConsoleSection.Title>
          <Suspense fallback={<SkeletonLine className="h-6 w-24" />}>
            <Message message="admin.settings.api_keys.title" />
          </Suspense>
        </ConsoleSection.Title>
        <ConsoleSection.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
            <Message message="admin.settings.api_keys.description" />
          </Suspense>
        </ConsoleSection.Description>
      </ConsoleSection.Heading>
    </ConsoleSection.Header>

    <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
      <dt className="text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
          <Message message="admin.settings.api_keys.tenant_id" />
        </Suspense>
      </dt>
      <dd className="grid gap-1">
        <TenantIdCopy tenantId={tenantId} />
        <span className="text-xs text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-3 w-72" />}>
            <Message message="admin.settings.api_keys.tenant_id_description" />
          </Suspense>
        </span>
      </dd>
    </dl>

    {loadErrorMessage ? (
      <FormMessage className="sm:max-w-3xl" variant="destructive">
        {loadErrorMessage}
      </FormMessage>
    ) : null}

    {!loadErrorMessage && apiKeys.length > 0 ? (
      <ApiKeyTable
        apiKeys={apiKeys}
        locale={locale}
        tenantId={tenantId}
        timeZone={timeZone}
      />
    ) : null}

    {!loadErrorMessage && apiKeys.length === 0 ? (
      <EmptyState.Root>
        <EmptyState.Heading>
          <EmptyState.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
              <Message message="admin.settings.api_keys.empty_title" />
            </Suspense>
          </EmptyState.Title>
          <EmptyState.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="admin.settings.api_keys.empty_description" />
            </Suspense>
          </EmptyState.Description>
        </EmptyState.Heading>
      </EmptyState.Root>
    ) : null}

    <Suspense fallback={<SkeletonLine className="h-40 w-full sm:max-w-3xl" />}>
      <ApiKeyCreateForm
        disabled={Boolean(loadErrorMessage)}
        tenantId={tenantId}
      />
    </Suspense>
  </ConsoleSection.Root>
);
