-- INDEX: idx_episode_free_windows_rule_series
-- The windows one series' free-after-publication rule wrote, which saving the
-- rule reads to remove the ones it no longer covers. Windows scheduled by hand
-- are left out, so the index holds only what a rule wrote.
--
-- CONCURRENTLY, so building it does not block the windows editors keep
-- scheduling, which is also why this statement is the whole file.
CREATE INDEX CONCURRENTLY idx_episode_free_windows_rule_series ON episode_free_windows USING btree (rule_series_id, episode_id)
    WHERE (rule_series_id IS NOT NULL);
