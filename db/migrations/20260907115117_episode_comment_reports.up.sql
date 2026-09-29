-- Reader reports on a published comment, and the counter of the open ones the
-- automatic removal threshold reads.

-- CONSTRAINT: episode_comments episode_comments_tenant_id_id_key
-- The composite foreign key below names (tenant_id, id), which PostgreSQL only
-- accepts against a unique constraint on exactly those columns. The table's
-- primary key is id alone, so the pair gets its own constraint here.
ALTER TABLE ONLY episode_comments
    ADD CONSTRAINT episode_comments_tenant_id_id_key UNIQUE (tenant_id, id);

-- COLUMN: episode_comments open_report_count
-- How many reports on this comment are still open. It is maintained by the
-- statement that writes a report rather than counted while a list is being
-- read: the removal threshold is checked on every report, and the moderation
-- queues span every comment of a tenant, so both would otherwise pay for a
-- count over episode_comment_reports on each row they show.
ALTER TABLE episode_comments
    ADD COLUMN open_report_count integer DEFAULT 0 NOT NULL;

ALTER TABLE episode_comments
    ADD CONSTRAINT episode_comments_open_report_count_check CHECK ((open_report_count >= 0));

-- TABLE: episode_comment_reports
-- One reader saying that one comment breaks the rules. Under `immediate` this
-- is the only signal a tenant gets before staff look at a comment at all, so
-- the row keeps who reported it and what they said, not just a tally.
--
-- status is the report's own life, separate from what happened to the comment:
-- 'resolved' is a report staff agreed with, 'rejected' one they did not, and
-- only an 'open' report counts towards the removal threshold. Deciding either
-- way therefore lowers the counter, which is why both terminal states are
-- spelled out instead of the row being deleted.
CREATE TABLE episode_comment_reports (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    comment_id uuid NOT NULL,
    reporter_user_id uuid NOT NULL,
    reason character varying(16) NOT NULL,
    -- What the reader wanted to add in their own words. Optional: the reason
    -- alone is a complete report, and 'other' is the one that usually earns a
    -- sentence.
    note text,
    status character varying(16) DEFAULT 'open'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    CONSTRAINT episode_comment_reports_reason_check CHECK (((reason)::text = ANY ((ARRAY['spam'::character varying, 'abuse'::character varying, 'spoiler'::character varying, 'other'::character varying])::text[]))),
    CONSTRAINT episode_comment_reports_status_check CHECK (((status)::text = ANY ((ARRAY['open'::character varying, 'resolved'::character varying, 'rejected'::character varying])::text[]))),
    -- An open report has not been decided, so it carries neither half of a
    -- decision; a decided one records when it was made. resolved_by is not
    -- required with it, because the staff account that decided can be deleted
    -- afterwards and audit_logs keeps who it was.
    CONSTRAINT episode_comment_reports_resolved_at_check CHECK (
        (((status)::text = 'open'::text) = (resolved_at IS NULL))
        AND (((status)::text <> 'open'::text) OR (resolved_by IS NULL))
    )
);

-- CONSTRAINT: episode_comment_reports episode_comment_reports_pkey
ALTER TABLE ONLY episode_comment_reports
    ADD CONSTRAINT episode_comment_reports_pkey PRIMARY KEY (id);

-- CONSTRAINT: episode_comment_reports episode_comment_reports_tenant_comment_reporter_key
-- One reader reports one comment once. Reporting again is not an error the
-- reader is told about — it simply changes nothing — and without this a single
-- account could drive a comment past the removal threshold on its own.
ALTER TABLE ONLY episode_comment_reports
    ADD CONSTRAINT episode_comment_reports_tenant_comment_reporter_key UNIQUE (tenant_id, comment_id, reporter_user_id);

-- FK CONSTRAINT: episode_comment_reports episode_comment_reports_tenant_comment_id_fkey
-- Composite FK prevents referencing a comment that belongs to another tenant.
-- CASCADE because a purged comment leaves nothing to report on: the reports of
-- a row staff deleted outright go with it, and audit_logs keeps the purge.
ALTER TABLE ONLY episode_comment_reports
    ADD CONSTRAINT episode_comment_reports_tenant_comment_id_fkey FOREIGN KEY (tenant_id, comment_id) REFERENCES episode_comments(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: episode_comment_reports episode_comment_reports_tenant_reporter_user_id_fkey
-- Composite FK prevents referencing a reader that belongs to another tenant.
-- CASCADE keeps the unique constraint honest: a deleted account's report must
-- not go on holding a slot no one can fill again.
ALTER TABLE ONLY episode_comment_reports
    ADD CONSTRAINT episode_comment_reports_tenant_reporter_user_id_fkey FOREIGN KEY (tenant_id, reporter_user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: episode_comment_reports episode_comment_reports_tenant_resolved_by_fkey
-- Composite and SET NULL as episode_comments does for its moderator columns:
-- the column list keeps tenant_id out of the action, so the row does not lose
-- the tenant its isolation policy filters on. A decided report stays decided
-- when the staff account that decided it is deleted.
ALTER TABLE ONLY episode_comment_reports
    ADD CONSTRAINT episode_comment_reports_tenant_resolved_by_fkey FOREIGN KEY (tenant_id, resolved_by) REFERENCES users(tenant_id, id) ON DELETE SET NULL (resolved_by);

-- INDEX: idx_episode_comment_reports_tenant_status_created_at
-- The report queue, which spans every comment of the tenant.
CREATE INDEX idx_episode_comment_reports_tenant_status_created_at ON episode_comment_reports USING btree (tenant_id, status, created_at DESC, id DESC);

-- INDEX: idx_episode_comment_reports_tenant_reporter_user_id
-- INDEX: idx_episode_comment_reports_tenant_resolved_by
-- The two foreign keys into users, in the column order their checks look the
-- rows up in. Deleting an account checks both, and neither the unique
-- constraint nor the queue index begins with the referencing column, so without
-- these a deletion scans every report the tenant has ever collected. Decided
-- reports are kept rather than removed, so that table only grows.
CREATE INDEX idx_episode_comment_reports_tenant_reporter_user_id ON episode_comment_reports USING btree (tenant_id, reporter_user_id);

CREATE INDEX idx_episode_comment_reports_tenant_resolved_by ON episode_comment_reports USING btree (tenant_id, resolved_by);

-- ROW SECURITY: episode_comment_reports
ALTER TABLE episode_comment_reports ENABLE ROW LEVEL SECURITY;

-- POLICY: episode_comment_reports episode_comment_reports_tenant_isolation
-- Tenant isolation, as on episode_comments: staff read every report of their
-- tenant, and no reader-facing response returns one at all.
CREATE POLICY episode_comment_reports_tenant_isolation ON episode_comment_reports USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
