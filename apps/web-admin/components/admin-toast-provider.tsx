"use client";

import { ToastProvider } from "@publira/ui-components";
import type { ReactNode } from "react";

export const AdminToastProvider = ({ children }: { children: ReactNode }) => (
  <ToastProvider>{children}</ToastProvider>
);
