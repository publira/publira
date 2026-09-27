import type { Locale } from "@publira/i18n";
import {
  EmptyState,
  EmptyStateDescription,
  EmptyStateHeading,
  EmptyStateTitle,
} from "@publira/ui-components/empty-state";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components/table";
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
      <EmptyState>
        <EmptyStateHeading>
          <EmptyStateTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.creators.accounts.empty_title" />
            </Suspense>
          </EmptyStateTitle>
          <EmptyStateDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="admin.creators.accounts.empty_description" />
            </Suspense>
          </EmptyStateDescription>
        </EmptyStateHeading>
      </EmptyState>
    ) : (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.creators.accounts.columns.name" />
              </Suspense>
            </TableHead>
            <TableHead>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.creators.accounts.columns.email" />
              </Suspense>
            </TableHead>
            <TableHead className="w-40">
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.creators.accounts.columns.linked_at" />
              </Suspense>
            </TableHead>
            <TableHead className="w-32">
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.creators.accounts.columns.actions" />
              </Suspense>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((account) => (
            <TableRow key={account.publicId}>
              <TableCell>
                <Link
                  className="font-medium underline-offset-4 hover:underline"
                  href={`/readers/${account.publicId}`}
                >
                  {account.name || account.publicId}
                </Link>
              </TableCell>
              <TableCell>{account.email}</TableCell>
              <TableCell className="tabular-nums">
                {formatDate(account.linkedAt, {
                  fallback: "—",
                  locale,
                  timeZone,
                })}
              </TableCell>
              <TableCell>
                <UnlinkCreatorAccountButton
                  creatorId={creatorId}
                  creatorPublicId={creatorPublicId}
                  name={account.name || account.email}
                  readerId={account.id}
                  readerPublicId={account.publicId}
                  tenantId={tenantId}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )}
  </div>
);
