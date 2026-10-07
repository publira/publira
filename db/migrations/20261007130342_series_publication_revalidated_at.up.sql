-- When the apply-series-publications batch dropped the public site caches for
-- a series whose publication instant had passed. NULL means that drop is still
-- owed, or that the instant is still ahead.
--
-- A series saved with a publication instant in the future becomes public when
-- that instant passes, and nothing writes to it then: the catalog reads compare
-- published_at against NOW(). What does not change on its own is every list and
-- page the web apps cached while the series was still hidden, so the batch
-- drops them once the instant has passed and records here that it did, which
-- lets a batch that was down over the instant catch up on its next pass.
--
-- Saving the series writes this column together with published_at: the save
-- drops the caches itself when the instant it stores has already passed, and
-- clears the column when it is still ahead.
ALTER TABLE series
    ADD COLUMN publication_revalidated_at timestamp with time zone;

-- Every series that is already public was dropped by the save that published
-- it, so none of them is owed anything.
UPDATE series
SET publication_revalidated_at = published_at
WHERE is_published
    AND published_at IS NOT NULL
    AND published_at <= NOW();
