import Image from "next/image";
import type { ReactNode } from "react";

import type { MyCreatorItem } from "#lib/creator-pages";
import { getMessages } from "#lib/get-messages";

/** The icon's size, as the heading draws it. */
const ICON_SIZE = 56;

const CreatorIcon = async ({ name, url }: { name: string; url: string }) => {
  const t = await getMessages();

  return (
    <Image
      alt={t("storefront.creators.icon_alt", { name })}
      className="size-14 shrink-0 rounded-surface object-cover"
      decoding="async"
      height={ICON_SIZE}
      src={url}
      width={ICON_SIZE}
    />
  );
};

/**
 * The Author a page is about, drawn with their icon where they have one. The
 * page writes its own heading in `children`, which is where the Author's name
 * goes on their page and under the month's title on a statement.
 */
export const CreatorHeading = ({
  children,
  creator,
}: {
  children: ReactNode;
  creator: MyCreatorItem;
}) => (
  <div className="flex items-center gap-4">
    {creator.iconImageUrl ? (
      <CreatorIcon name={creator.name} url={creator.iconImageUrl} />
    ) : null}
    <div className="grid min-w-0 gap-1">{children}</div>
  </div>
);
