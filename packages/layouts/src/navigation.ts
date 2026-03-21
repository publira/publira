import type { ComponentType, SVGProps } from "react";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export interface NavItem {
  href: string;
  label: string;
  description: string;
  icon: IconComponent;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const isCurrentPath = (pathname: string, href: string): boolean => {
  if (href === "/") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
};
