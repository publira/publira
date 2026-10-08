import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import type { ReactNode } from "react";

/**
 * One numeric limit on a policy form. The label is the caller's element, so
 * the key it renders is written where the field is placed.
 */
export const PolicyLimitField = ({
  children,
  defaultValue,
  disabled,
  min = 1,
  name,
}: {
  children: ReactNode;
  defaultValue: number;
  disabled: boolean;
  /** The smallest value the server accepts for this limit. */
  min?: number;
  name: string;
}) => (
  <Field>
    <FieldLabel required>{children}</FieldLabel>
    <FieldContent>
      <Input
        defaultValue={String(defaultValue)}
        disabled={disabled}
        min={min}
        name={name}
        required
        type="number"
      />
    </FieldContent>
  </Field>
);
