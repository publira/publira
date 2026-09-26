import { Badge } from "@publira/ui-components/badge";
import { LinkButton } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { TableCell, TableRow } from "@publira/ui-components/table";
import Link from "next/link";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { ConfigurationState } from "#lib/configuration-status";

export const ConfigurationStatusBadge = ({
  state,
}: {
  state: ConfigurationState | "unavailable";
}) => {
  switch (state) {
    case "configured": {
      return (
        <Badge tone="success" variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="platform.configuration.status.configured" />
          </Suspense>
        </Badge>
      );
    }
    case "needs_setup": {
      return (
        <Badge tone="warning" variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="platform.configuration.status.needs_setup" />
          </Suspense>
        </Badge>
      );
    }
    case "not_configured": {
      return (
        <Badge tone="muted" variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="platform.configuration.status.not_configured" />
          </Suspense>
        </Badge>
      );
    }
    case "defaults": {
      return (
        <Badge tone="muted" variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="platform.configuration.status.defaults" />
          </Suspense>
        </Badge>
      );
    }
    case "unavailable": {
      return (
        <Badge tone="destructive" variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="platform.configuration.status.unavailable" />
          </Suspense>
        </Badge>
      );
    }
    default: {
      return null;
    }
  }
};

/** An area that needs setup gets the filled button, so it stands out. */
export const ConfigurationAction = ({
  href,
  state,
}: {
  href: string;
  state: ConfigurationState | "unavailable";
}) =>
  state === "needs_setup" ? (
    <LinkButton render={<Link href={href} />} size="sm">
      <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
        <Message message="platform.configuration.actions.set_up" />
      </Suspense>
    </LinkButton>
  ) : (
    <LinkButton render={<Link href={href} />} size="sm" variant="outline">
      <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
        <Message message="platform.configuration.actions.manage" />
      </Suspense>
    </LinkButton>
  );

export const ConfigurationRow = ({
  action,
  details,
  name,
  necessity,
  status,
}: {
  action: ReactNode;
  details: ReactNode;
  name: ReactNode;
  necessity: ReactNode;
  status: ReactNode;
}) => (
  <TableRow>
    <TableCell className="align-top">
      <div className="grid gap-0.5">
        <span className="font-medium text-foreground">{name}</span>
        <span className="text-xs text-muted-foreground">{necessity}</span>
      </div>
    </TableCell>
    <TableCell className="align-top whitespace-nowrap">{status}</TableCell>
    <TableCell className="align-top text-muted-foreground">{details}</TableCell>
    <TableCell className="text-right align-top">{action}</TableCell>
  </TableRow>
);

/** The same four cells, while the read behind a row is in flight. */
export const ConfigurationRowSkeleton = () => (
  <TableRow>
    <TableCell>
      <div className="grid gap-1">
        <SkeletonLine className="h-4 w-32" />
        <SkeletonLine className="h-3 w-16" />
      </div>
    </TableCell>
    <TableCell>
      <SkeletonLine className="h-4 w-20" />
    </TableCell>
    <TableCell>
      <SkeletonLine className="h-4 w-full" />
    </TableCell>
    <TableCell>
      <SkeletonLine className="ml-auto h-8 w-20" />
    </TableCell>
  </TableRow>
);
