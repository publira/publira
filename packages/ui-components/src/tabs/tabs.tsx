"use client";

import { Tabs as BaseTabs } from "@base-ui/react/tabs";
import { cn } from "@publira/utils";

export type TabsProps = BaseTabs.Root.Props;

export const Tabs = ({ className, ...props }: TabsProps) => (
  <BaseTabs.Root {...props} className={cn("grid gap-4", className)} />
);

export type TabsListProps = BaseTabs.List.Props;

export const TabsList = ({ className, ...props }: TabsListProps) => (
  <BaseTabs.List
    {...props}
    className={cn("flex items-center gap-1 border-b border-border", className)}
  />
);

export type TabsTabProps = BaseTabs.Tab.Props;

export const TabsTab = ({ className, ...props }: TabsTabProps) => (
  <BaseTabs.Tab
    {...props}
    className={cn(
      "-mb-px cursor-pointer border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition-colors duration-state ease-state hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 data-[active]:border-primary data-[active]:text-foreground",
      className
    )}
  />
);

export type TabsPanelProps = BaseTabs.Panel.Props;

export const TabsPanel = ({ className, ...props }: TabsPanelProps) => (
  <BaseTabs.Panel
    {...props}
    className={cn("focus-visible:outline-none", className)}
  />
);
