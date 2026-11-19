import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { VolumeItem } from "#lib/volume";

import { setVolumeBookstoreLinksAction } from "../../_lib/actions";
import { VolumeBookstoreLinksEditor } from "./volume-bookstore-links-editor";

interface VolumeBookstoreLinksFormProps {
  seriesId: string;
  tenantId: string;
  volume: VolumeItem;
}

/**
 * Where the volume's printed book is sold, which `SetVolumeBookstoreLinks`
 * replaces whole.
 */
export const VolumeBookstoreLinksForm = ({
  seriesId,
  tenantId,
  volume,
}: VolumeBookstoreLinksFormProps) => (
  <ConsoleSection.Root>
    <ConsoleSection.Header>
      <ConsoleSection.Heading>
        <ConsoleSection.Title>
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <Message message="admin.series.volumes.bookstore_links.title" />
          </Suspense>
        </ConsoleSection.Title>
        <ConsoleSection.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.series.volumes.bookstore_links.description" />
          </Suspense>
        </ConsoleSection.Description>
      </ConsoleSection.Heading>
    </ConsoleSection.Header>
    <ActionForm.Root
      action={setVolumeBookstoreLinksAction}
      className="grid gap-4"
    >
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="series_id" type="hidden" value={seriesId} />
      <input name="volume_id" type="hidden" value={volume.id} />
      <VolumeBookstoreLinksEditor
        initialLinks={volume.bookstoreLinks}
        // A save remounts the editor on the list the API stored.
        key={JSON.stringify(volume.bookstoreLinks)}
      />
      <div className="flex justify-end">
        <ActionForm.Submit>
          <ActionForm.Idle>
            <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
              <Message message="admin.series.volumes.bookstore_links.save" />
            </Suspense>
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.series.volumes.form.submitting" />
            </Suspense>
          </ActionForm.Pending>
        </ActionForm.Submit>
      </div>
    </ActionForm.Root>
  </ConsoleSection.Root>
);
