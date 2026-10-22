// Package contentevents holds the parts of the raw engagement log that belong
// to no single caller: the projections that file an event from the table which
// owns the fact, and the retention that takes the rows away again.
// content_events is append-only and high volume, so the rows themselves are
// kept for a bounded window and the durable numbers live in the aggregates
// (content_daily_stats) built from them. Keeping the raw log short is also
// what keeps the personal data in it bounded.
//
// # What the log holds
//
// Every event names its tenant, the series it counts towards, and the actor it
// is counted for. The series is read from the server's own episodes row, never
// taken from the client, so an event can only be filed under the series its
// episode belongs to. The actor is user_id for a signed-in reader and
// anonymous_id otherwise, and actor_key folds the two into one column with
// COALESCE. Four kinds are written, each by the code that owns the fact behind
// it:
//
//   - episode_view and series_view are the soft PV that the public API's
//     RecordContentView files when a reader opens a detail page. They mean the
//     page was opened, not that its body was read. A signed-out reader is
//     counted by the publira_aid cookie, a server-minted UUIDv7 and nothing
//     else. Repeats inside a fixed 30-minute epoch bucket collapse on a
//     partial unique index, a prefetch is not counted, and the payload is
//     {"pv_kind":"soft"} with no IP address, user agent, or email address in
//     it. A view is instrumentation, so a write that fails is logged and the
//     RPC succeeds.
//   - rating is one press of the rating control, filed by the public API's
//     RateEpisode in the transaction that raises episode_ratings. It carries
//     the points the press added rather than the score the reader now stands
//     at, needs a session, and is never taken back: a reader who presses again
//     files another event, and episode_ratings holds the score itself. Nothing
//     reconciles ratings afterwards, so a failure is returned to the reader.
//   - episode_complete is the projection of an episode_reads row, keyed by
//     (source_table, source_id) so that it can be replayed, and filed at the
//     read's own read_at, so a late projection still lands on the day the
//     member finished. MarkEpisodeAsRead swallows a failure to file it, and
//     [Projector] files whatever the request path lost.
//   - comment is filed by [ProjectComment] when a comment becomes public — on
//     posting under the immediate comment mode, on approval under
//     approval_required — at the comment's published_at. A comment that never
//     became public has none, and one hidden or withdrawn afterwards keeps the
//     one it earned, which is why content_daily_stats.comment_count is counted
//     from episode_comments rather than from these events.
//
// # Retention
//
// The shape is one table plus chunked deletes, which is the simplest thing
// that reclaims the space. Either of two observations is the trigger to
// reconsider it in favour of declarative partitioning by occurred_at, dropping
// a partition instead of deleting rows: one purge no longer fits in its
// interval (the elapsed time is in its completion log), or the table and its
// indexes outgrow what autovacuum keeps up with, since the bloat a delete
// leaves does not come back down on its own.
package contentevents
