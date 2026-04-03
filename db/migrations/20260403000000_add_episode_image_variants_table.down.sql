-- episode_image_variants テーブルを削除し、バリアント固有のカラムを episode_images テーブルへ戻す。

ALTER TABLE episode_images
    ADD COLUMN storage_provider VARCHAR(32),
    ADD COLUMN object_key TEXT,
    ADD COLUMN image_url TEXT,
    ADD COLUMN content_type VARCHAR(255),
    ADD COLUMN file_size_bytes BIGINT,
    ADD COLUMN width INT,
    ADD COLUMN height INT;

-- バリアントのデータを episode_images テーブルへ戻す（各画像について幅が最大のバリアントを選ぶ）
UPDATE episode_images ei
SET
    storage_provider = eiv.storage_provider,
    object_key       = eiv.object_key,
    image_url        = '',
    content_type     = eiv.content_type,
    file_size_bytes  = eiv.file_size_bytes,
    width            = eiv.width,
    height           = eiv.height
FROM (
    SELECT DISTINCT ON (episode_image_id)
        episode_image_id,
        storage_provider,
        object_key,
        content_type,
        file_size_bytes,
        width,
        height
    FROM episode_image_variants
    ORDER BY episode_image_id, width DESC
) eiv
WHERE ei.id = eiv.episode_image_id;

-- NOT NULL 制約を再設定する（データが存在する場合のみ有効）
ALTER TABLE episode_images
    ALTER COLUMN storage_provider SET NOT NULL,
    ALTER COLUMN object_key SET NOT NULL,
    ALTER COLUMN image_url SET NOT NULL,
    ALTER COLUMN content_type SET NOT NULL,
    ALTER COLUMN file_size_bytes SET NOT NULL,
    ALTER COLUMN width SET NOT NULL,
    ALTER COLUMN height SET NOT NULL;

DROP TABLE episode_image_variants;
