-- COLUMN: campaign_banners.alt_text
-- The words drawn into the banner's image, which nothing else stored with the
-- banner holds, so a screen reader can name each banner's link by its own
-- campaign. Empty is a banner nobody has described yet, which every existing
-- row is: a client then names the link with its own generic text. The admin
-- API trims what it stores, so the bound counts the text a reader hears.
ALTER TABLE campaign_banners
    ADD COLUMN alt_text text DEFAULT ''::text NOT NULL,
    ADD CONSTRAINT campaign_banners_alt_text_check CHECK ((char_length(alt_text) <= 255));
