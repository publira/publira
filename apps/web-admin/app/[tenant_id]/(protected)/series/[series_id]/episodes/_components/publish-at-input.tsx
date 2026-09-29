import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { InstantInput } from "#components/instant-input";
import { Message } from "#components/message";

interface PublishAtInputProps {
  /** What a value means on this form; the create form and the schedule differ. */
  children: ReactNode;
  /** The stored publication instant, empty while there is none. */
  initialValue?: string;
  timeZone: string;
}

/** When the episode is published, posted as `publish_at`. */
export const PublishAtInput = ({
  children,
  initialValue,
  timeZone,
}: PublishAtInputProps) => (
  <Field>
    <FieldLabel>
      <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
        <Message message="admin.series.episodes.form.publish_at" />
      </Suspense>
    </FieldLabel>
    <FieldContent>
      <InstantInput
        initialValue={initialValue}
        name="publish_at"
        step={60}
        timeZone={timeZone}
      />
      <FieldDescription>{children}</FieldDescription>
    </FieldContent>
  </Field>
);
