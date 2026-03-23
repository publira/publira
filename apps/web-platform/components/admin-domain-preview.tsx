import { cn } from "@publira/utils";

interface AdminDomainPreviewProps {
  adminDomain?: string;
  className?: string;
  domain?: string;
  showCurrentDomain?: boolean;
}

export const AdminDomainPreview = ({
  adminDomain = "",
  className,
  domain = "",
  showCurrentDomain = false,
}: AdminDomainPreviewProps) => {
  const trimmedAdminDomain = adminDomain.trim();
  const trimmedDomain = domain.trim();

  if (trimmedAdminDomain) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        管理画面ドメインとして
        <span className="mx-1 rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
          {trimmedAdminDomain}
        </span>
        を使用します。
      </p>
    );
  }

  if (showCurrentDomain && trimmedDomain) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        管理画面ドメインの設定がない場合は
        <span className="mx-1 inline-flex gap-x-1 rounded border border-border bg-muted px-1 py-0.5 align-middle leading-none">
          <span className="font-semibold text-foreground">admin.</span>
          <span className="text-foreground/65">{trimmedDomain}</span>
        </span>
        が使われます。
      </p>
    );
  }

  return (
    <p className={cn("text-sm text-muted-foreground", className)}>
      管理画面ドメインの設定がない場合は、公開ページのドメインの先頭に
      <span className="mx-1 inline-flex rounded border border-border bg-muted px-1 py-0.5 align-middle leading-none">
        <span className="font-semibold text-foreground">admin.</span>
        <span className="text-foreground/65">
          {trimmedDomain || "example.com"}
        </span>
      </span>
      を付けたドメインが管理画面に使われます。
    </p>
  );
};
