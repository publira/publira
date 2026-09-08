DROP TABLE IF EXISTS episode_free_windows;

-- Nothing else in this schema uses btree_gist, so it leaves with the table that
-- brought it in.
DROP EXTENSION IF EXISTS btree_gist;
