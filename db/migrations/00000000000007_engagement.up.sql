-- Engagement: Reader follows and reads, plus the event, aggregate, ranking and
-- recommendation feature tables built on them.

-- TABLE: creator_follows
-- Creator follows are a separate relation from episode follows because their
-- aggregation and lifecycle requirements differ.
CREATE TABLE creator_follows (
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    creator_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: creator_follows creator_follows_pkey
ALTER TABLE ONLY creator_follows
    ADD CONSTRAINT creator_follows_pkey PRIMARY KEY (tenant_id, user_id, creator_id);

-- FK CONSTRAINT: creator_follows creator_follows_tenant_creator_id_fkey
ALTER TABLE ONLY creator_follows
    ADD CONSTRAINT creator_follows_tenant_creator_id_fkey FOREIGN KEY (tenant_id, creator_id) REFERENCES creators(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: creator_follows creator_follows_tenant_user_id_fkey
ALTER TABLE ONLY creator_follows
    ADD CONSTRAINT creator_follows_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- INDEX: idx_creator_follows_tenant_user_created_at
CREATE INDEX idx_creator_follows_tenant_user_created_at ON creator_follows USING btree (tenant_id, user_id, created_at DESC, creator_id);

-- ROW SECURITY: creator_follows
ALTER TABLE creator_follows ENABLE ROW LEVEL SECURITY;

-- POLICY: creator_follows creator_follows_member_isolation
CREATE POLICY creator_follows_member_isolation ON creator_follows
    USING (
        (tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)
        AND (user_id = (NULLIF(current_setting('app.current_user_id'::text, true), ''::text))::uuid)
    )
    WITH CHECK (
        (tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)
        AND (user_id = (NULLIF(current_setting('app.current_user_id'::text, true), ''::text))::uuid)
    );

-- TABLE: series_follows
-- Series follows are independent from episode and creator follows. Following a
-- work does not follow its episodes or authors.
CREATE TABLE series_follows (
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    series_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: series_follows series_follows_pkey
ALTER TABLE ONLY series_follows
    ADD CONSTRAINT series_follows_pkey PRIMARY KEY (tenant_id, user_id, series_id);

-- FK CONSTRAINT: series_follows series_follows_tenant_series_id_fkey
ALTER TABLE ONLY series_follows
    ADD CONSTRAINT series_follows_tenant_series_id_fkey FOREIGN KEY (tenant_id, series_id) REFERENCES series(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: series_follows series_follows_tenant_user_id_fkey
ALTER TABLE ONLY series_follows
    ADD CONSTRAINT series_follows_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- INDEX: idx_series_follows_tenant_user_created_at
CREATE INDEX idx_series_follows_tenant_user_created_at ON series_follows USING btree (tenant_id, user_id, created_at DESC, series_id);

-- ROW SECURITY: series_follows
ALTER TABLE series_follows ENABLE ROW LEVEL SECURITY;

-- POLICY: series_follows series_follows_member_isolation
CREATE POLICY series_follows_member_isolation ON series_follows
    USING (
        (tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)
        AND (user_id = (NULLIF(current_setting('app.current_user_id'::text, true), ''::text))::uuid)
    )
    WITH CHECK (
        (tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)
        AND (user_id = (NULLIF(current_setting('app.current_user_id'::text, true), ''::text))::uuid)
    );

-- TABLE: episode_follows
-- Episode follows are intentionally independent from creator follows.
CREATE TABLE episode_follows (
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    episode_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: episode_follows episode_follows_pkey
ALTER TABLE ONLY episode_follows
    ADD CONSTRAINT episode_follows_pkey PRIMARY KEY (tenant_id, user_id, episode_id);

-- FK CONSTRAINT: episode_follows episode_follows_tenant_episode_id_fkey
ALTER TABLE ONLY episode_follows
    ADD CONSTRAINT episode_follows_tenant_episode_id_fkey FOREIGN KEY (tenant_id, episode_id) REFERENCES episodes(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: episode_follows episode_follows_tenant_user_id_fkey
ALTER TABLE ONLY episode_follows
    ADD CONSTRAINT episode_follows_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- INDEX: idx_episode_follows_tenant_user_created_at
CREATE INDEX idx_episode_follows_tenant_user_created_at ON episode_follows USING btree (tenant_id, user_id, created_at DESC, episode_id);

-- ROW SECURITY: episode_follows
ALTER TABLE episode_follows ENABLE ROW LEVEL SECURITY;

-- POLICY: episode_follows episode_follows_member_isolation
CREATE POLICY episode_follows_member_isolation ON episode_follows
    USING (
        (tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)
        AND (user_id = (NULLIF(current_setting('app.current_user_id'::text, true), ''::text))::uuid)
    )
    WITH CHECK (
        (tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)
        AND (user_id = (NULLIF(current_setting('app.current_user_id'::text, true), ''::text))::uuid)
    );

-- TABLE: episode_reads
-- A member's first completed read of an episode. The composite primary key
-- makes repeated and concurrent completion notifications idempotent.
--
-- id is a surrogate key, not the identity of the read: the composite key is
-- what a repeated notification collides on, so the row keeps the id it was
-- first inserted with. That stability is what it is for. content_events files
-- the analytics projection of this row under (source_table, source_id), and a
-- composite key cannot fit in source_id.
CREATE TABLE episode_reads (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    episode_id uuid NOT NULL,
    read_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: episode_reads episode_reads_pkey
ALTER TABLE ONLY episode_reads
    ADD CONSTRAINT episode_reads_pkey PRIMARY KEY (tenant_id, user_id, episode_id);

-- CONSTRAINT: episode_reads episode_reads_id_key
ALTER TABLE ONLY episode_reads
    ADD CONSTRAINT episode_reads_id_key UNIQUE (id);

-- FK CONSTRAINT: episode_reads episode_reads_tenant_episode_id_fkey
ALTER TABLE ONLY episode_reads
    ADD CONSTRAINT episode_reads_tenant_episode_id_fkey FOREIGN KEY (tenant_id, episode_id) REFERENCES episodes(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: episode_reads episode_reads_tenant_user_id_fkey
ALTER TABLE ONLY episode_reads
    ADD CONSTRAINT episode_reads_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- ROW SECURITY: episode_reads
ALTER TABLE episode_reads ENABLE ROW LEVEL SECURITY;

-- POLICY: episode_reads episode_reads_member_isolation
CREATE POLICY episode_reads_member_isolation ON episode_reads
    USING (
        (tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)
        AND (user_id = (NULLIF(current_setting('app.current_user_id'::text, true), ''::text))::uuid)
    )
    WITH CHECK (
        (tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)
        AND (user_id = (NULLIF(current_setting('app.current_user_id'::text, true), ''::text))::uuid)
    );

-- TABLE: content_events
-- L1: append-only engagement events (views, ratings, purchase projections).
CREATE TABLE content_events (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    event_type character varying(32) NOT NULL,
    user_id uuid,
    anonymous_id uuid,
    actor_key uuid GENERATED ALWAYS AS (COALESCE(user_id, anonymous_id)) STORED,
    series_id uuid,
    episode_id uuid,
    debounce_bucket bigint,
    rating_score smallint,
    source_table character varying(64),
    source_id uuid,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT content_events_event_type_check CHECK (((event_type)::text = ANY ((ARRAY['series_view'::character varying, 'episode_view'::character varying, 'episode_complete'::character varying, 'purchase'::character varying, 'access_grant'::character varying, 'rating'::character varying, 'favorite'::character varying])::text[]))),
    CONSTRAINT content_events_actor_check CHECK (((user_id IS NOT NULL) OR (anonymous_id IS NOT NULL))),
    CONSTRAINT content_events_rating_score_check CHECK (((rating_score IS NULL) OR ((rating_score >= 1) AND (rating_score <= 5)))),
    CONSTRAINT content_events_source_pair_check CHECK ((((source_table IS NULL) AND (source_id IS NULL)) OR ((source_table IS NOT NULL) AND (source_id IS NOT NULL)))),
    CONSTRAINT content_events_target_by_type_check CHECK ((
        (((event_type)::text = ANY ((ARRAY['episode_view'::character varying, 'episode_complete'::character varying, 'purchase'::character varying, 'access_grant'::character varying])::text[])) AND (episode_id IS NOT NULL) AND (series_id IS NOT NULL))
        OR (((event_type)::text = ANY ((ARRAY['series_view'::character varying, 'favorite'::character varying])::text[])) AND (series_id IS NOT NULL) AND (episode_id IS NULL))
        OR (((event_type)::text = 'rating'::text) AND (series_id IS NOT NULL))
    )),
    CONSTRAINT content_events_view_bucket_check CHECK ((((event_type)::text <> ALL ((ARRAY['episode_view'::character varying, 'series_view'::character varying])::text[])) OR (debounce_bucket IS NOT NULL))),
    CONSTRAINT content_events_rating_requires_score_check CHECK ((((event_type)::text <> 'rating'::text) OR (rating_score IS NOT NULL)))
);

-- CONSTRAINT: content_events content_events_pkey
ALTER TABLE ONLY content_events
    ADD CONSTRAINT content_events_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: content_events content_events_tenant_episode_id_fkey
-- MATCH SIMPLE: a NULL episode_id (series_view / favorite / series rating) skips this check.
ALTER TABLE ONLY content_events
    ADD CONSTRAINT content_events_tenant_episode_id_fkey FOREIGN KEY (tenant_id, episode_id) REFERENCES episodes(tenant_id, id) ON DELETE RESTRICT;

-- FK CONSTRAINT: content_events content_events_tenant_id_fkey
ALTER TABLE ONLY content_events
    ADD CONSTRAINT content_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: content_events content_events_tenant_series_id_fkey
-- MATCH SIMPLE: a NULL series_id skips this check. Requires series_tenant_id_id_key.
ALTER TABLE ONLY content_events
    ADD CONSTRAINT content_events_tenant_series_id_fkey FOREIGN KEY (tenant_id, series_id) REFERENCES series(tenant_id, id) ON DELETE RESTRICT;

-- FK CONSTRAINT: content_events content_events_tenant_user_id_fkey
-- MATCH SIMPLE: a NULL user_id (anonymous actor) skips this check.
ALTER TABLE ONLY content_events
    ADD CONSTRAINT content_events_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- INDEX: idx_content_events_episode_view_debounce
-- Fixed 30-minute epoch bucket; same actor + episode + bucket collapses to one row.
CREATE UNIQUE INDEX idx_content_events_episode_view_debounce ON content_events USING btree (tenant_id, event_type, episode_id, actor_key, debounce_bucket) WHERE ((event_type)::text = 'episode_view'::text);

-- INDEX: idx_content_events_occurred_at
-- Retention purge (cmd/batch purge-content-events) walks the oldest rows across every
-- tenant at once, so none of the tenant-leading indexes here can serve it.
CREATE INDEX idx_content_events_occurred_at ON content_events USING btree (occurred_at);

-- INDEX: idx_content_events_series_view_debounce
CREATE UNIQUE INDEX idx_content_events_series_view_debounce ON content_events USING btree (tenant_id, event_type, series_id, actor_key, debounce_bucket) WHERE ((event_type)::text = 'series_view'::text);

-- INDEX: idx_content_events_source_unique
-- Idempotent projections from SoT tables (purchases, access_tickets).
CREATE UNIQUE INDEX idx_content_events_source_unique ON content_events USING btree (tenant_id, source_table, source_id) WHERE (source_id IS NOT NULL);

-- INDEX: idx_content_events_tenant_anon_occurred_at
CREATE INDEX idx_content_events_tenant_anon_occurred_at ON content_events USING btree (tenant_id, anonymous_id, occurred_at DESC) WHERE (anonymous_id IS NOT NULL);

-- INDEX: idx_content_events_tenant_episode_occurred_at
CREATE INDEX idx_content_events_tenant_episode_occurred_at ON content_events USING btree (tenant_id, episode_id, occurred_at DESC) WHERE (episode_id IS NOT NULL);

-- INDEX: idx_content_events_tenant_occurred_at
CREATE INDEX idx_content_events_tenant_occurred_at ON content_events USING btree (tenant_id, occurred_at DESC);

-- INDEX: idx_content_events_tenant_series_occurred_at
CREATE INDEX idx_content_events_tenant_series_occurred_at ON content_events USING btree (tenant_id, series_id, occurred_at DESC) WHERE (series_id IS NOT NULL);

-- INDEX: idx_content_events_tenant_type_occurred_at
CREATE INDEX idx_content_events_tenant_type_occurred_at ON content_events USING btree (tenant_id, event_type, occurred_at DESC);

-- INDEX: idx_content_events_tenant_user_occurred_at
CREATE INDEX idx_content_events_tenant_user_occurred_at ON content_events USING btree (tenant_id, user_id, occurred_at DESC) WHERE (user_id IS NOT NULL);

-- ROW SECURITY: content_events
ALTER TABLE content_events ENABLE ROW LEVEL SECURITY;

-- POLICY: content_events content_events_tenant_isolation
CREATE POLICY content_events_tenant_isolation ON content_events USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: content_daily_stats
-- L2: daily per-item aggregates consumed by the ranking and feature builds.
--
-- complete_count and member_view_count are the two halves of the read-through
-- rate and are deliberately measured over the same cohort: signed-in members.
-- view_count and unique_viewer_count count every actor including anonymous
-- readers, so neither can be the denominator of a rate whose numerator only
-- members can produce.
CREATE TABLE content_daily_stats (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    stat_date date NOT NULL,
    entity_type character varying(16) NOT NULL,
    entity_id uuid NOT NULL,
    view_count bigint DEFAULT 0 NOT NULL,
    unique_viewer_count bigint DEFAULT 0 NOT NULL,
    member_view_count bigint DEFAULT 0 NOT NULL,
    purchase_count bigint DEFAULT 0 NOT NULL,
    complete_count bigint DEFAULT 0 NOT NULL,
    rating_count bigint DEFAULT 0 NOT NULL,
    rating_sum bigint DEFAULT 0 NOT NULL,
    favorite_count bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT content_daily_stats_entity_type_check CHECK (((entity_type)::text = ANY ((ARRAY['series'::character varying, 'episode'::character varying])::text[]))),
    CONSTRAINT content_daily_stats_nonneg_check CHECK (((view_count >= 0) AND (unique_viewer_count >= 0) AND (member_view_count >= 0) AND (purchase_count >= 0) AND (complete_count >= 0) AND (rating_count >= 0) AND (rating_sum >= 0) AND (favorite_count >= 0)))
);

-- CONSTRAINT: content_daily_stats content_daily_stats_pkey
ALTER TABLE ONLY content_daily_stats
    ADD CONSTRAINT content_daily_stats_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: content_daily_stats content_daily_stats_tenant_id_fkey
ALTER TABLE ONLY content_daily_stats
    ADD CONSTRAINT content_daily_stats_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_content_daily_stats_tenant_date
CREATE INDEX idx_content_daily_stats_tenant_date ON content_daily_stats USING btree (tenant_id, stat_date DESC);

-- INDEX: idx_content_daily_stats_tenant_entity
CREATE INDEX idx_content_daily_stats_tenant_entity ON content_daily_stats USING btree (tenant_id, entity_type, entity_id, stat_date DESC);

-- INDEX: idx_content_daily_stats_unique
CREATE UNIQUE INDEX idx_content_daily_stats_unique ON content_daily_stats USING btree (tenant_id, stat_date, entity_type, entity_id);

-- ROW SECURITY: content_daily_stats
ALTER TABLE content_daily_stats ENABLE ROW LEVEL SECURITY;

-- POLICY: content_daily_stats content_daily_stats_tenant_isolation
CREATE POLICY content_daily_stats_tenant_isolation ON content_daily_stats USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: content_ranking_snapshots
-- L4: persisted ranking output. One row is one leaderboard, keyed by tenant,
-- period, entity type, and the algorithm version that scored it.
CREATE TABLE content_ranking_snapshots (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    ranking_key character varying(64) NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    entity_type character varying(16) NOT NULL,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    algorithm_version integer DEFAULT 1 NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT content_ranking_snapshots_entity_type_check CHECK (((entity_type)::text = ANY ((ARRAY['series'::character varying, 'episode'::character varying])::text[])))
);

-- CONSTRAINT: content_ranking_snapshots content_ranking_snapshots_pkey
ALTER TABLE ONLY content_ranking_snapshots
    ADD CONSTRAINT content_ranking_snapshots_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: content_ranking_snapshots content_ranking_snapshots_tenant_id_fkey
ALTER TABLE ONLY content_ranking_snapshots
    ADD CONSTRAINT content_ranking_snapshots_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_content_ranking_snapshots_tenant_key_computed
CREATE INDEX idx_content_ranking_snapshots_tenant_key_computed ON content_ranking_snapshots USING btree (tenant_id, ranking_key, entity_type, computed_at DESC);

-- INDEX: idx_content_ranking_snapshots_unique
CREATE UNIQUE INDEX idx_content_ranking_snapshots_unique ON content_ranking_snapshots USING btree (tenant_id, ranking_key, period_start, period_end, entity_type, algorithm_version);

-- ROW SECURITY: content_ranking_snapshots
ALTER TABLE content_ranking_snapshots ENABLE ROW LEVEL SECURITY;

-- POLICY: content_ranking_snapshots content_ranking_snapshots_tenant_isolation
CREATE POLICY content_ranking_snapshots_tenant_isolation ON content_ranking_snapshots USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: item_recommend_features
-- L3: per-item feature snapshot for online inference.
CREATE TABLE item_recommend_features (
    tenant_id uuid NOT NULL,
    entity_type character varying(16) NOT NULL,
    entity_id uuid NOT NULL,
    features jsonb DEFAULT '{}'::jsonb NOT NULL,
    feature_version integer DEFAULT 1 NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT item_recommend_features_entity_type_check CHECK (((entity_type)::text = ANY ((ARRAY['series'::character varying, 'episode'::character varying])::text[]))),
    CONSTRAINT item_recommend_features_feature_version_check CHECK ((feature_version > 0))
);

-- CONSTRAINT: item_recommend_features item_recommend_features_pkey
ALTER TABLE ONLY item_recommend_features
    ADD CONSTRAINT item_recommend_features_pkey PRIMARY KEY (tenant_id, entity_type, entity_id);

-- FK CONSTRAINT: item_recommend_features item_recommend_features_tenant_id_fkey
ALTER TABLE ONLY item_recommend_features
    ADD CONSTRAINT item_recommend_features_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: item_recommend_features
ALTER TABLE item_recommend_features ENABLE ROW LEVEL SECURITY;

-- POLICY: item_recommend_features item_recommend_features_tenant_isolation
CREATE POLICY item_recommend_features_tenant_isolation ON item_recommend_features USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: user_recommend_features
-- L3: per-user feature snapshot for online inference.
CREATE TABLE user_recommend_features (
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    features jsonb DEFAULT '{}'::jsonb NOT NULL,
    feature_version integer DEFAULT 1 NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_recommend_features_feature_version_check CHECK ((feature_version > 0))
);

-- CONSTRAINT: user_recommend_features user_recommend_features_pkey
ALTER TABLE ONLY user_recommend_features
    ADD CONSTRAINT user_recommend_features_pkey PRIMARY KEY (tenant_id, user_id);

-- FK CONSTRAINT: user_recommend_features user_recommend_features_tenant_user_id_fkey
ALTER TABLE ONLY user_recommend_features
    ADD CONSTRAINT user_recommend_features_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- ROW SECURITY: user_recommend_features
ALTER TABLE user_recommend_features ENABLE ROW LEVEL SECURITY;

-- POLICY: user_recommend_features user_recommend_features_tenant_isolation
CREATE POLICY user_recommend_features_tenant_isolation ON user_recommend_features USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
