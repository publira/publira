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

export const isCurrentPath = (
  pathname: string,
  href: string,
  allHrefs?: string[]
): boolean => {
  if (href === "/") {
    return pathname === href;
  }
  if (pathname === href) {
    return true;
  }
  if (!pathname.startsWith(`${href}/`)) {
    return false;
  }
  // プレフィックスで一致しているが、より具体的な別のナビアイテムも一致する場合は非アクティブにする
  if (allHrefs) {
    return !allHrefs.some(
      (other) =>
        other !== href &&
        other.startsWith(`${href}/`) &&
        (pathname === other || pathname.startsWith(`${other}/`))
    );
  }
  return true;
};
