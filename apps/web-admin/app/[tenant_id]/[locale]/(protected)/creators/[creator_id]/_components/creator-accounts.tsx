import type { Locale } from "@publira/i18n";
import * as EmptyState from "@publira/ui-components/empty-state";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatDate } from "@publira/utils";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { CreatorAccountItem } from "#lib/creator";

import { CreatorAccountLinkForm } from "./creator-account-link-form";
import { UnlinkCreatorAccountButton } from "./unlink-creator-account-button";

interface CreatorAccountsProps {
  accounts: CreatorAccountItem[];
  creatorId: string;
  creatorPublicId: string;
  locale: Locale;
  tenantId: string;
  timeZone: string;
}

/** The reader accounts linked to one creator, and the form that adds one. */
export const CreatorAccounts = ({
  accounts,
  creatorId,
  creatorPublicId,
  locale,
  tenantId,
  timeZone,
}: CreatorAccountsProps) => (
  <div className="grid gap-6">
    <CreatorAccountLinkForm
      creatorId={creatorId}
      creatorPublicId={creatorPublicId}
      tenantId={tenantId}
    />
    {accounts.length === 0 ? (
      <EmptyState.Root>
        <EmptyState.Heading>
          <EmptyState.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.creators.accounts.empty_title" />
            </Suspense>
          </EmptyState.Title>
          <EmptyState.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="admin.creators.accounts.empty_description" />
            </Suspense>
          </EmptyState.Description>
        </EmptyState.Heading>
      </EmptyState.Root>
    ) : (
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.creators.accounts.columns.name" />
              </Suspense>
            </Table.Head>
            <Table.Head>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.creators.accounts.columns.email" />
              </Suspense>
            </Table.Head>
            <Table.Head className="w-40">
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.creators.accounts.columns.linked_at" />
              </Suspense>
            </Table.Head>
            <Table.Head className="w-32">
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.creators.accounts.columns.actions" />
              </Suspense>
            </Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {accounts.map((account) => (
            <Table.Row key={account.publicId}>
              <Table.Cell>
                <Link
                  className="font-medium underline-offset-4 hover:underline"
                  href={`/readers/${account.publicId}`}
                >
                  {account.name || account.publicId}
                </Link>
              </Table.Cell>
              <Table.Cell>{account.email}</Table.Cell>
              <Table.Cell className="tabular-nums">
                {formatDate(account.linkedAt, {
                  fallback: "—",
                  locale,
                  timeZone,
                })}
              </Table.Cell>
              <Table.Cell>
                <UnlinkCreatorAccountButton
                  creatorId={creatorId}
                  creatorPublicId={creatorPublicId}
                  name={account.name || account.email}
                  readerId={account.id}
                  readerPublicId={account.publicId}
                  tenantId={tenantId}
                />
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    )}
  </div>
);
