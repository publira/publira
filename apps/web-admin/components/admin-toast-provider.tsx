"use client";

import * as Toast from "@publira/ui-components/toast";
import type { ReactNode } from "react";

import { useClientMessages } from "./client-message";

/**
 * Reads the catalog inside the toast rather than in the provider: the provider
 * wraps every signed-in route, and a read there would hold back each route's
 * static shell, while a toast is only drawn once one is raised.
 */
const AdminToastClose = () => {
  const t = useClientMessages();

  return <Toast.Close aria-label={t("admin.common.close")} />;
};

export const AdminToastProvider = ({ children }: { children: ReactNode }) => (
  <Toast.Provider>
    {children}
    <Toast.Stack>
      <AdminToastClose />
    </Toast.Stack>
  </Toast.Provider>
);
