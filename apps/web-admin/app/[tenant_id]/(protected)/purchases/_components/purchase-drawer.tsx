"use client";

import { Drawer, DrawerContent } from "@publira/ui-components/drawer";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";

interface PurchaseDrawerProps {
  /** The detail the drawer shows, rendered on the server. */
  children: ReactNode;
  /** The list's own URL, without the purchase, which closing returns to. */
  closeHref: string;
}

/**
 * The detail of the purchase the URL names, over the list.
 *
 * The URL is what opens it, so a link to a purchase can be shared and the
 * back button closes it. Closing it waits for the sheet to slide out and then
 * replaces the purchase's history entry with `closeHref`, which re-renders the
 * list without it and leaves the back button nothing to reopen. The caller
 * keys the drawer on the purchase, so another one opens fresh.
 */
export const PurchaseDrawer = ({
  children,
  closeHref,
}: PurchaseDrawerProps) => {
  const router = useRouter();
  const [open, setOpen] = useState(true);

  return (
    <Drawer
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) {
          router.replace(closeHref, { scroll: false });
        }
      }}
      open={open}
    >
      <DrawerContent>{children}</DrawerContent>
    </Drawer>
  );
};
