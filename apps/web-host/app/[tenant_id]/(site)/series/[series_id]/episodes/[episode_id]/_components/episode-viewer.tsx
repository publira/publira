import Image from "next/image";

import type { EpisodeImageItem } from "#lib/catalog";

export const EpisodeViewer = ({
  episodeTitle,
  images,
}: {
  episodeTitle: string;
  images: EpisodeImageItem[];
}) => {
  if (images.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-border/70 bg-muted/20 px-6 py-14 text-center text-muted-foreground">
        本文画像はまだ公開されていません。
      </div>
    );
  }

  return (
    <ol className="space-y-4">
      {images.map((image, index) => (
        <li
          key={image.id}
          className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm"
        >
          <Image
            alt={`${episodeTitle} ${index + 1}ページ`}
            className="h-auto w-full bg-muted object-contain"
            decoding="async"
            height={image.height}
            loading={index === 0 ? "eager" : "lazy"}
            sizes="100vw"
            src={image.imageUrl}
            unoptimized
            width={image.width}
          />
        </li>
      ))}
    </ol>
  );
};
