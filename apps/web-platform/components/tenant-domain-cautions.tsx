import { cn } from "@publira/utils";

interface TenantDomainCautionsProps {
  mode: "create" | "update";
  className?: string;
}

const baseCautions = [
  "設定変更は各アプリのプロキシキャッシュにより、反映まで最大5分かかる場合があります。",
  "ドメインは全テナント間で一意である必要があります。すでに他テナントで使用中のドメインは設定できません。",
  "DNS の設定変更は別途行う必要があります。新ドメインが本サービスに向いていることを事前にご確認ください。",
];

const updateOnlyCautions = [
  "ドメインの変更後も旧ドメインへのアクセスはキャッシュが解消されるまで（最大5分）有効な状態が続くため、移行のタイミングにご注意ください。",
];

export const TenantDomainCautions = ({
  mode,
  className,
}: TenantDomainCautionsProps) => {
  const cautions =
    mode === "update" ? [...baseCautions, ...updateOnlyCautions] : baseCautions;

  return (
    <section
      className={cn("grid gap-2 rounded-md border px-3 py-2", className)}
    >
      <p className="text-sm font-medium">ドメイン設定時の注意</p>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {cautions.map((caution) => (
          <li key={caution}>{caution}</li>
        ))}
      </ul>
    </section>
  );
};
