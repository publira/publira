-- FUNCTION: credited_creator_of_account
-- The creator an account comments as on one episode: a creator the account is
-- linked to through creator_accounts and that the episode credits. It answers
-- about the episode rather than the account, so the same account commenting on
-- a work it is not credited on gets NULL, as does an account linked to no
-- creator at all. Every comment list asks it once per row, and sqlc cannot
-- share a subquery between queries, so the rule is written here once.
--
-- One comment carries one name. An account whose creators hold several credits
-- on the episode — an original author who also draws it, or two pen names on
-- one work — is named by the credit that sorts first in the order
-- ListEpisodeCreatorsByEpisodeIDs prints the credit line in, with the id last
-- so two credits that tie on everything else still give one answer.
--
-- SECURITY INVOKER keeps the row-level security of the tables it reads the
-- caller's own, as reader_may_open_episode does.
CREATE FUNCTION credited_creator_of_account(tenant_id uuid, user_id uuid, episode_id uuid) RETURNS uuid
    LANGUAGE sql
    STABLE
    PARALLEL SAFE
    SECURITY INVOKER
AS $$
    SELECT c.id
    FROM creator_accounts ca
        JOIN episode_creators ec ON ec.tenant_id = ca.tenant_id
            AND ec.creator_id = ca.creator_id
        JOIN creators c ON c.id = ec.creator_id
        LEFT JOIN creator_roles cr ON cr.id = ec.role_id
    WHERE ca.tenant_id = credited_creator_of_account.tenant_id
        AND ca.user_id = credited_creator_of_account.user_id
        AND ec.episode_id = credited_creator_of_account.episode_id
    ORDER BY cr.display_priority ASC NULLS LAST,
        ec.display_order ASC,
        c.name ASC,
        c.id ASC
    LIMIT 1
$$;
