import { cn } from "@publira/utils";
import type { ReactNode } from "react";

export interface TenantDomainCautionsCopy {
  items: readonly string[];
  title: ReactNode;
}

export const TenantDomainCautions = ({
  className,
  copy,
}: {
  className?: string;
  copy: TenantDomainCautionsCopy;
}) => (
  <section className={cn("grid gap-2 rounded-md border px-3 py-2", className)}>
    <p className="text-sm font-medium">{copy.title}</p>
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {copy.items.map((caution) => (
        <li key={caution}>{caution}</li>
      ))}
    </ul>
  </section>
);
