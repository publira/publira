-- Every query that decides access reads episode_grants, and the oldest release
-- an upgrade starts from reads nothing else, so the view kept for the release
-- before goes.
DROP VIEW episode_content_grants;
