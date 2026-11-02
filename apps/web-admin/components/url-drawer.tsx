"use client";

import * as Drawer from "@publira/ui-components/drawer";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";

interface UrlDrawerProps {
  /** The detail the drawer shows, rendered on the server. */
  children: ReactNode;
  /** The list's own URL, without the record, which closing returns to. */
  closeHref: string;
}

/**
 * The detail of the record the URL names — a purchase, a reconciliation —
 * over the list.
 *
 * The URL is what opens it, so a link to the record can be shared and the
 * back button closes it. Closing it waits for the sheet to slide out and then
 * replaces the record's history entry with `closeHref`, which re-renders the
 * list without it and leaves the back button nothing to reopen. The caller
 * keys the drawer on the record, so another one opens fresh.
 */
export const UrlDrawer = ({ children, closeHref }: UrlDrawerProps) => {
  const router = useRouter();
  const [open, setOpen] = useState(true);

  return (
    <Drawer.Root
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) {
          router.replace(closeHref, { scroll: false });
        }
      }}
      open={open}
    >
      <Drawer.Content>{children}</Drawer.Content>
    </Drawer.Root>
  );
};
