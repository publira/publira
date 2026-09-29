DROP TABLE IF EXISTS episode_free_windows;

-- btree_gist stays. The `up` created it with IF NOT EXISTS, so it may have been
-- installed before this migration ran and be in use by something this schema
-- does not own; dropping it here would take that away on a rollback.
