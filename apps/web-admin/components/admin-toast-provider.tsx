"use client";

import * as Toast from "@publira/ui-components/toast";
import type { ReactNode } from "react";

export const AdminToastProvider = ({ children }: { children: ReactNode }) => (
  <Toast.Provider>{children}</Toast.Provider>
);
