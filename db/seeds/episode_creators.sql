-- The credits of every episode a seed wrote, copied from its series.
--
-- Creating an episode through the admin API bakes the series' credits onto it
-- in the same transaction; a seeded episode is written straight into the table
-- and never goes through that path, so it gets them here. The storefront reads
-- an episode's own credits and never falls back to the series, so without this
-- a seeded catalogue would show every episode as credited to nobody.
--
-- Included with `\ir` from every seed that inserts an episode, rather than
-- copied into each, so the copy has one place to be read and changed.
--
-- `source` is `series` because that is what these rows are — the team the
-- series carries — and re-running a seed finds them rather than writing a
-- second set.
INSERT INTO episode_creators (tenant_id, episode_id, creator_id, role_id, display_order, source)
SELECT e.tenant_id,
    e.id,
    sc.creator_id,
    sc.role_id,
    sc.display_order,
    'series'
FROM episodes e
JOIN series_creators sc ON sc.series_id = e.series_id
ON CONFLICT (episode_id, creator_id, role_id) DO NOTHING;
