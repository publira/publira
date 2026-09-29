"use client";

import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { CheckIcon } from "@publira/icons/check-icon";
import { cn } from "@publira/utils";

import { useFieldsetDisabled } from "../fieldset/fieldset";

export type CheckboxProps = BaseCheckbox.Root.Props;

export const Checkbox = ({ className, disabled, ...props }: CheckboxProps) => {
  const fieldsetDisabled = useFieldsetDisabled();

  return (
    <BaseCheckbox.Root
      {...props}
      disabled={fieldsetDisabled || disabled}
      className={cn(
        "relative inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-control border border-input bg-card transition-colors duration-state ease-state focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-[checked]:border-primary data-[checked]:bg-primary",
        className
      )}
    >
      <BaseCheckbox.Indicator className="flex items-center justify-center text-primary-foreground">
        <CheckIcon className="size-3" />
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
};
