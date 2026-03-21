"use client";

export {
  ConsoleLayout,
  ConsoleHeader,
  ConsoleSidebar,
  defaultConsoleGradient,
} from "./console-layout";
export type {
  ConsoleCurrentUser,
  ConsoleHeaderProps,
  ConsoleLayoutProps,
  ConsoleSidebarProps,
} from "./console-layout";

export { ConsolePage } from "./console-page";
export type { ConsolePageProps } from "./console-page";

export { isCurrentPath } from "../navigation";
export type { NavItem, NavSection } from "../navigation";
