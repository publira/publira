-- Take the counts back out. episode_reading_positions is untouched, but it
-- keeps no history, so a day rebuilt again counts only the readers who have
-- not moved since.
DROP TABLE IF EXISTS episode_page_reach_stats;
