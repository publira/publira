import { Popover as BasePopover } from "@base-ui/react/popover";
import { cn } from "@publira/utils";
import type { JSX, ReactNode } from "react";

import { FLOATING_TRANSITION } from "../motion";

export const Popover: typeof BasePopover.Root = BasePopover.Root;
export const PopoverTrigger: typeof BasePopover.Trigger = BasePopover.Trigger;
export const PopoverTitle: typeof BasePopover.Title = BasePopover.Title;

export type PopoverContentProps = Omit<
  BasePopover.Positioner.Props,
  "children" | "className"
> & {
  children: ReactNode;
  className?: string;
  popupProps?: Omit<BasePopover.Popup.Props, "children" | "className">;
};

/**
 * A floating surface positioned against {@link PopoverTrigger}.
 *
 * Portal, viewport constraints, and the shared surface treatment belong here
 * so application code only chooses placement and content.
 */
export const PopoverContent = ({
  children,
  className,
  popupProps,
  ...positionerProps
}: PopoverContentProps): JSX.Element => (
  <BasePopover.Portal>
    <BasePopover.Positioner
      {...positionerProps}
      className="z-40 outline-hidden"
    >
      <BasePopover.Popup
        {...popupProps}
        className={cn(
          "max-w-[calc(100vw-2rem)] origin-[var(--transform-origin)] rounded-surface border border-border bg-popover p-1.5 text-popover-foreground shadow-floating outline-hidden",
          FLOATING_TRANSITION,
          className
        )}
      >
        {children}
      </BasePopover.Popup>
    </BasePopover.Positioner>
  </BasePopover.Portal>
);
