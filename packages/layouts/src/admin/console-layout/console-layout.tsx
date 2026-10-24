import type { ReactNode } from "react";

import { ConsoleLayoutClient } from "./console-layout-client";

export const ConsoleLayout = ({ children }: { children: ReactNode }) => (
  <ConsoleLayoutClient>{children}</ConsoleLayoutClient>
);

export const ConsoleLayoutMain = ({ children }: { children: ReactNode }) => (
  <main className="flex-1 overflow-x-hidden">{children}</main>
);

export const ConsoleLayoutContent = ({ children }: { children: ReactNode }) => (
  <div className="flex min-w-0 flex-1 flex-col">{children}</div>
);
