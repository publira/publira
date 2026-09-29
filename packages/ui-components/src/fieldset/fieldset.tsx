"use client";

import { Fieldset as BaseFieldset } from "@base-ui/react/fieldset";
import { cn } from "@publira/utils";
import { createContext, use } from "react";

const FieldsetDisabledContext = createContext(false);

/**
 * Whether an enclosing `Fieldset` is disabled. A control Base UI renders as a
 * `<span>` reads it here when it sits outside a `Field`, since neither Base
 * UI's field context nor the native `<fieldset>` reaches it there.
 */
export const useFieldsetDisabled = () => use(FieldsetDisabledContext);

export type FieldsetProps = BaseFieldset.Root.Props;

/**
 * A group of fields that can be closed at once.
 *
 * `disabled` reaches every control inside a `Field` through Base UI's context,
 * and every native control through the `<fieldset>` element itself.
 */
export const Fieldset = ({
  className,
  disabled = false,
  ...props
}: FieldsetProps) => {
  const closed = useFieldsetDisabled() || disabled;

  return (
    <FieldsetDisabledContext value={closed}>
      <BaseFieldset.Root
        {...props}
        className={cn("min-w-0", className)}
        disabled={closed}
      />
    </FieldsetDisabledContext>
  );
};
