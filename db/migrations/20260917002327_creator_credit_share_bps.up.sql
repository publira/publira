ALTER TABLE series_creators
ADD COLUMN share_bps integer NOT NULL DEFAULT 0 CHECK (share_bps BETWEEN 0 AND 10000);

ALTER TABLE episode_creators
ADD COLUMN share_bps integer NOT NULL DEFAULT 0 CHECK (share_bps BETWEEN 0 AND 10000);
