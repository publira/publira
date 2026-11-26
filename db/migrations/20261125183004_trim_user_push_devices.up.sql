-- A reader now keeps at most 20 push devices (maxPushDevicesPerAccount in
-- server/api/publicapi), and a registration past that replaces the one
-- updated longest ago. Rows registered before the cap existed are held to it
-- here the same way, so an account that already holds more stops having every
-- notification sent to all of them.
DELETE FROM user_push_devices d
USING (
    SELECT
        token,
        row_number() OVER (
            PARTITION BY tenant_id, user_id
            ORDER BY updated_at DESC, token DESC
        ) AS newest
    FROM user_push_devices
) ranked
WHERE d.token = ranked.token
    AND ranked.newest > 20;
