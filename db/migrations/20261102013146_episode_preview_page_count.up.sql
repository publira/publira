-- How many of a priced episode's opening pages anyone may read without buying
-- it. 0 opens none, which is what every episode had before the column existed.
ALTER TABLE episode_listings
ADD COLUMN preview_page_count integer NOT NULL DEFAULT 0 CHECK (preview_page_count >= 0);

-- FUNCTION: episode_page_in_preview
-- Whether one page of an episode is among the pages its preview opens: the
-- first preview_page_count pages of a priced episode, in reading order. The
-- image route asks it of a page on the path that names a reader and on the one
-- that names nobody, and the catalog asks it of every page when it lists the
-- preview, and sqlc compiles each query on its own, so the rule is written here
-- once and the three agree on which pages are open.
--
-- A page is an image row with at least one stored rendition, counted the way
-- ListEpisodePreviewImagesByEpisodeID and GetEpisodePreviewImageByIDForTenant
-- count it: an upload writes the row before its renditions and outside a
-- transaction, so a failed one can leave a row no reader is ever shown, and
-- counting it would open one page fewer than the publisher chose.
--
-- A free episode has no preview, whatever its count says: its whole body is
-- already open, and the count is kept for the day it is priced again. Whether
-- the episode is published, and the age rule, are the caller's to apply, as
-- they are for a free body.
--
-- SECURITY INVOKER keeps the row-level security of the tables it reads the
-- caller's own, as reader_may_open_episode does.
CREATE FUNCTION episode_page_in_preview(episode_id uuid, episode_image_id uuid)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    PARALLEL SAFE
    SECURITY INVOKER
AS $$
    SELECT episode_page_in_preview.episode_image_id IN (
        SELECT opening.id
        FROM episode_images opening
        WHERE opening.episode_id = episode_page_in_preview.episode_id
            AND EXISTS (
                SELECT 1
                FROM episode_image_variants rendition
                WHERE rendition.episode_image_id = opening.id
            )
        ORDER BY opening.display_order ASC,
            opening.created_at ASC,
            opening.id ASC
        -- No listing, or a free one, is no preview rather than no limit,
        -- which is what a NULL here would read as.
        LIMIT COALESCE((
            SELECT el.preview_page_count
            FROM episode_listings el
            WHERE el.episode_id = episode_page_in_preview.episode_id
                AND el.price > 0
        ), 0)
    )
$$;
