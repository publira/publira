-- Which of its ratings a tenant makes a reader prove an age for.

-- COLUMN: tenant_config age_verification
-- Three answers rather than a switch per rating: a tenant that gates `r15`
-- while leaving `r18` open is not a policy anyone means, so the values are the
-- rungs of one ladder — none, `r18` alone, then `r15` and `r18` together.
--
-- It defaults to `none` because a rating on a series is a statement about who
-- the work is for, and turning that into a wall a reader has to climb is a
-- separate decision the tenant makes: a tenant upgrading to a build that has
-- this column must not find its catalogue newly closed to everyone who has
-- never given a birth date.
ALTER TABLE tenant_config
    ADD COLUMN age_verification text DEFAULT 'none'::text NOT NULL;

ALTER TABLE tenant_config
    ADD CONSTRAINT tenant_config_age_verification_check CHECK ((age_verification = ANY (ARRAY['none'::text, 'r18'::text, 'r15_and_r18'::text])));
