-- COLUMN: page_versions agreement_required_at
-- When a publication of this version asked every reader to agree to the page
-- again. NULL for a version no publication asked for, which is how a correction
-- is published without asking anyone. A version republished with the request
-- takes the time of that publication.
ALTER TABLE ONLY page_versions
    ADD COLUMN agreement_required_at timestamp with time zone;

-- CONSTRAINT: page_versions page_versions_agreement_required_published_check
-- Only a publication asks for agreement, so a draft never carries the time.
ALTER TABLE ONLY page_versions
    ADD CONSTRAINT page_versions_agreement_required_published_check CHECK (((agreement_required_at IS NULL) OR ((status)::text = 'published'::text)));

-- FUNCTION: reader_has_agreed_to_page
-- Whether a reader has agreed to a page as far as its tenant asks them to. A
-- page that no publication has asked agreement for needs none beyond the one
-- given at sign-up. Otherwise the reader has to have agreed to a version that
-- was published at or after the last request made in that version's own
-- translation: each translation keeps its own history, so a request made in
-- one locale does not stale an agreement to a translation whose text did not
-- change, and an agreement to a version superseded before the request — one a
-- sign-up form held open across it, say — does not count.
--
-- SECURITY INVOKER keeps page_versions and user_page_consents behind the
-- caller's own row-level security, as published_page_translation_for does.
CREATE FUNCTION reader_has_agreed_to_page(user_id uuid, page_id uuid) RETURNS boolean
    LANGUAGE sql
    STABLE
    PARALLEL SAFE
    SECURITY INVOKER
AS $$
    SELECT NOT EXISTS (
            SELECT 1
            FROM page_versions requested
            WHERE requested.page_id = reader_has_agreed_to_page.page_id
                AND requested.agreement_required_at IS NOT NULL
        )
        OR EXISTS (
            SELECT 1
            FROM user_page_consents c
                JOIN page_versions agreed ON agreed.id = c.page_version_id
            WHERE c.user_id = reader_has_agreed_to_page.user_id
                AND agreed.page_id = reader_has_agreed_to_page.page_id
                AND NOT EXISTS (
                    SELECT 1
                    FROM page_versions requested
                    WHERE requested.translation_id = agreed.translation_id
                        AND requested.agreement_required_at > agreed.published_at
                )
        )
$$;
