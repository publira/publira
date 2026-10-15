import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import { cn } from "@publira/utils";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

type DivProps = ComponentPropsWithoutRef<"div">;

/**
 * The drawer itself. A side sheet is dismissed by swiping it back the way it
 * came, so `swipeDirection` defaults to the edge {@link DrawerContent} sits on
 * rather than Base UI's bottom sheet.
 */
export const Drawer = ({
  swipeDirection = "right",
  ...props
}: BaseDrawer.Root.Props) => (
  <BaseDrawer.Root {...props} swipeDirection={swipeDirection} />
);
export const DrawerTrigger = BaseDrawer.Trigger;
export const DrawerClose = BaseDrawer.Close;
export const DrawerTitle = BaseDrawer.Title;
export const DrawerDescription = BaseDrawer.Description;

/**
 * A sheet along the right edge of the viewport, over a backdrop, for the
 * detail of one row of a list: the list stays where it was behind it.
 *
 * It slides in from the edge it is dismissed towards and follows a swipe,
 * which Base UI reports as `--drawer-swipe-movement-x`. `motion-reduce` takes
 * the slide away, as it does every floating layer's transition.
 */
export const DrawerContent = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <BaseDrawer.Portal>
    {/* Every console screen sits inside the drawer the console's own
        navigation opens in on a phone, so Base UI takes this one for a nested
        drawer and skips its backdrop unless told to render it. */}
    <BaseDrawer.Backdrop
      className="fixed inset-0 z-40 bg-foreground/20 transition-opacity duration-state ease-state data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none"
      forceRender
    />
    <BaseDrawer.Viewport className="fixed inset-0 z-50">
      <BaseDrawer.Popup
        className={cn(
          "fixed inset-y-0 right-0 flex w-[min(92vw,32rem)] translate-x-[var(--drawer-swipe-movement-x,0px)] flex-col gap-5 overflow-y-auto border-l border-border bg-card p-5 text-card-foreground shadow-floating outline-hidden transition-[translate] duration-state ease-state data-[ending-style]:translate-x-full data-[starting-style]:translate-x-full data-[swiping]:transition-none motion-reduce:transition-none",
          className
        )}
      >
        {children}
      </BaseDrawer.Popup>
    </BaseDrawer.Viewport>
  </BaseDrawer.Portal>
);

export const DrawerHeader = ({ className, ...props }: DivProps) => (
  <div
    {...props}
    className={cn("flex items-start justify-between gap-3", className)}
  />
);
