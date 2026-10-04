-- How often one reader may ask UseTicket to spend a wait-for-free ticket.
-- A ticket that is spent is bounded by the series' recharge interval, but a
-- refused request is not, and each one reads the episode, the rule, and the
-- reader's grants before it is refused.

-- COLUMN: platform_policy_config wait_free_ticket_use_limit_per_minute
-- COLUMN: platform_policy_config wait_free_ticket_use_limit_per_day
-- A saved row gets the built-in defaults, which is what it enforces from now
-- on. The defaults are then dropped: no value column of this table has one, so
-- an insert that forgets a value fails.
ALTER TABLE platform_policy_config
    ADD COLUMN wait_free_ticket_use_limit_per_minute integer DEFAULT 10 NOT NULL,
    ADD COLUMN wait_free_ticket_use_limit_per_day integer DEFAULT 100 NOT NULL;

ALTER TABLE platform_policy_config
    ALTER COLUMN wait_free_ticket_use_limit_per_minute DROP DEFAULT,
    ALTER COLUMN wait_free_ticket_use_limit_per_day DROP DEFAULT;

-- CONSTRAINT: platform_policy_config platform_policy_config_wait_free_ticket_use_limit_check
ALTER TABLE ONLY platform_policy_config
    ADD CONSTRAINT platform_policy_config_wait_free_ticket_use_limit_check CHECK (((wait_free_ticket_use_limit_per_minute >= 1) AND (wait_free_ticket_use_limit_per_day >= wait_free_ticket_use_limit_per_minute)));
