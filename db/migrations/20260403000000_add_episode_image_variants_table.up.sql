-- episode_image_variants テーブルをつくり、1画像1行の論理エンティティ構造へ移行する。
-- 既存の episode_images 行はそれぞれ 'original' ラベルのバリアントとして保存し、
-- バリアント固有のカラムを episode_images テーブルから削除する。

CREATE TABLE episode_image_variants (
    id UUID PRIMARY KEY,
    episode_image_id UUID NOT NULL REFERENCES episode_images(id) ON DELETE CASCADE,
    label VARCHAR(32) NOT NULL,
    storage_provider VARCHAR(32) NOT NULL,
    object_key TEXT NOT NULL,
    content_type VARCHAR(255) NOT NULL,
    file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
    width INT NOT NULL CHECK (width > 0),
    height INT NOT NULL CHECK (height > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_episode_image_variants_episode_image_id ON episode_image_variants (episode_image_id);

-- 既存データの移行: 各 episode_images 行を 'original' ラベルのバリアントとして登録する
INSERT INTO episode_image_variants (
    id,
    episode_image_id,
    label,
    storage_provider,
    object_key,
    content_type,
    file_size_bytes,
    width,
    height,
    created_at
)
SELECT
    gen_random_uuid(),
    id,
    'original',
    storage_provider,
    object_key,
    content_type,
    file_size_bytes,
    width,
    height,
    created_at
FROM episode_images;

-- バリアント固有のカラムを episode_images テーブルから削除する
ALTER TABLE episode_images
    DROP COLUMN storage_provider,
    DROP COLUMN object_key,
    DROP COLUMN image_url,
    DROP COLUMN content_type,
    DROP COLUMN file_size_bytes,
    DROP COLUMN width,
    DROP COLUMN height;
