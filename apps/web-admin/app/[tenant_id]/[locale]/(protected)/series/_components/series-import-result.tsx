"use client";

import { Badge } from "@publira/ui-components/badge";
import * as Table from "@publira/ui-components/table";
import Link from "next/link";

import { ClientMessage } from "#components/client-message";
import type { SeriesImportRow } from "#lib/series-import-manifest";

const STATUS_TONE = {
  failed: "destructive",
  imported: "success",
  not_started: "muted",
} as const;

interface SeriesImportResultProps {
  rows: readonly SeriesImportRow[];
  seriesPublicId: string;
}

/**
 * One row per episode of the manifest, in its order. An episode that failed
 * after it was created links to what is left of it, since that is what has to
 * be finished or deleted before the import goes on.
 */
export const SeriesImportResult = ({
  rows,
  seriesPublicId,
}: SeriesImportResultProps) => (
  <Table.Root>
    <Table.Header>
      <Table.Row>
        <Table.Head>
          <ClientMessage message="admin.series.import.result.column_episode" />
        </Table.Head>
        <Table.Head>
          <ClientMessage message="admin.series.import.result.column_pages" />
        </Table.Head>
        <Table.Head>
          <ClientMessage message="admin.series.import.result.column_outcome" />
        </Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {rows.map((row) => (
        <Table.Row key={row.position}>
          <Table.Cell>
            {row.episodePublicId ? (
              <Link
                className="underline"
                href={`/series/${seriesPublicId}/episodes/${row.episodePublicId}`}
              >
                {row.title}
              </Link>
            ) : (
              row.title
            )}
          </Table.Cell>
          <Table.Cell>{row.pageCount}</Table.Cell>
          <Table.Cell>
            <div className="grid justify-items-start gap-1">
              <Badge tone={STATUS_TONE[row.status]}>
                <ClientMessage
                  message={`admin.series.import.result.${row.status}`}
                />
              </Badge>
              {row.message ? (
                <span className="text-sm text-muted-foreground">
                  {row.message}
                </span>
              ) : null}
            </div>
          </Table.Cell>
        </Table.Row>
      ))}
    </Table.Body>
  </Table.Root>
);
