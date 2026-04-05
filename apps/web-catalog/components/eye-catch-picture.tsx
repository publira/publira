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

/** content-type 優先順: avif > webp > その他(jpeg/png 等) */
const CT_PRIORITY: Record<string, number> = {
  "image/avif": 0,
  "image/webp": 1,
};

/**
 * 複数幅のバリアントから <img srcset> 要素を生成する。
 *
 * - preferredType (デフォルト: "landscape") に一致するバリアントを使用する。
 *   一致がなければ全バリアントにフォールバックする。
 * - 複数のコンテンツタイプが混在する場合は最も優先度が高いタイプのバリアントのみ使用する。
 *   (DB ユニーク制約により同一サイズが複数フォーマットで存在することは基本ないが念のため)
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

  // 最も優先度の高い content-type のバリアントを選択
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
    // eslint-disable-next-line @next/next/no-img-element
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
