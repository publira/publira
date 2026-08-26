import { cn } from "@publira/utils";
import type { ReactNode } from "react";

const interpolateDomain = (template: string, domain: ReactNode): ReactNode => {
  const placeholder = "{domain}";
  const index = template.indexOf(placeholder);
  if (index === -1) {
    return template;
  }

  return (
    <>
      {template.slice(0, index)}
      {domain}
      {template.slice(index + placeholder.length)}
    </>
  );
};

export interface AdminDomainPreviewCopy {
  current: string;
  prefix: string;
  set: string;
}

export const AdminDomainPreview = ({
  adminDomain = "",
  className,
  copy,
  domain = "",
  showCurrentDomain = false,
}: {
  adminDomain?: string;
  className?: string;
  copy: AdminDomainPreviewCopy;
  domain?: string;
  showCurrentDomain?: boolean;
}) => {
  const trimmedAdminDomain = adminDomain.trim();
  const trimmedDomain = domain.trim();

  if (trimmedAdminDomain) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        {interpolateDomain(
          copy.set,
          <span className="mx-1 rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
            {trimmedAdminDomain}
          </span>
        )}
      </p>
    );
  }

  const prefixedDomain = (
    <span className="mx-1 inline-flex gap-x-1 rounded border border-border bg-muted px-1 py-0.5 align-middle leading-none">
      <span className="font-semibold text-foreground">admin.</span>
      <span className="text-foreground/65">
        {trimmedDomain || "example.com"}
      </span>
    </span>
  );

  if (showCurrentDomain && trimmedDomain) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        {interpolateDomain(copy.current, prefixedDomain)}
      </p>
    );
  }

  return (
    <p className={cn("text-sm text-muted-foreground", className)}>
      {interpolateDomain(copy.prefix, prefixedDomain)}
    </p>
  );
};
