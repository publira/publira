export interface EyeCatchVariant {
  variantType: string;
  url: string;
  contentType: string;
  width: number;
  height: number;
}

interface EyeCatchPictureProps {
  variants: EyeCatchVariant[];
  alt: string;
  preferredType?: string;
  sizes?: string;
  imgClassName?: string;
  loading?: "lazy" | "eager";
  fetchPriority?: "high" | "low" | "auto";
}

/** Content-type preference: avif > webp > anything else (jpeg, png, …). */
const CT_PRIORITY: Record<string, number> = {
  "image/avif": 0,
  "image/webp": 1,
};

/**
 * Builds an `<img srcset>` from the variants of several widths.
 *
 * - Uses the variants matching `preferredType` (default: `"landscape"`),
 *   falling back to every variant when none matches.
 * - When several content types are mixed in, keeps only the variants of the
 *   highest-priority type. A unique constraint in the database makes one size
 *   in several formats unlikely, but the mix is handled rather than assumed
 *   away.
 */
export const EyeCatchPicture = ({
  variants,
  alt,
  preferredType = "landscape",
  sizes = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw",
  imgClassName,
  loading = "lazy",
  fetchPriority,
}: EyeCatchPictureProps) => {
  const filtered = variants.filter((v) => v.variantType === preferredType);
  const pool = filtered.length > 0 ? filtered : variants;

  if (pool.length === 0) {
    return null;
  }

  // Pick the variants of the highest-priority content type.
  const [bestType] = [...new Set(pool.map((v) => v.contentType))].toSorted(
    (a, b) => (CT_PRIORITY[a] ?? 99) - (CT_PRIORITY[b] ?? 99)
  );
  const best = pool
    .filter((v) => v.contentType === bestType)
    .toSorted((a, b) => a.width - b.width);

  const largest = best.at(-1);

  if (!largest) {
    return null;
  }

  const srcSet = best.map((v) => `${v.url} ${v.width}w`).join(", ");

  return (
    // Responsive art-direction via srcSet; next/image lacks equivalent for multi-URL variants.
    // oxlint-disable-next-line next/no-img-element, react-doctor/nextjs-no-img-element
    <img
      alt={alt}
      className={imgClassName}
      decoding="async"
      fetchPriority={fetchPriority}
      height={largest.height}
      loading={loading}
      sizes={sizes}
      src={largest.url}
      srcSet={srcSet}
      width={largest.width}
    />
  );
};
