UPDATE series
SET is_published = (published_at IS NOT NULL),
    updated_at = NOW()
WHERE is_published IS DISTINCT FROM (published_at IS NOT NULL);
