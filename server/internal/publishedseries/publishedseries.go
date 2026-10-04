// Package publishedseries is the first stage of the published series list:
// the keyset scans that settle which series one page holds, in which order,
// and under which filters. The catalog list and the SQL catalog search
// backend both page through them, so a search narrows and sorts exactly as
// the list does. Reading what a page shows is the caller's second stage.
package publishedseries

import (
	"context"
	"database/sql"
	"strconv"
	"time"

	"github.com/google/uuid"

	dbmodels "github.com/publira/publira/server/internal/db/gen"
)

// The columns a list can be sorted by.
const (
	ColumnPublishedAt     = "published_at"
	ColumnTitle           = "title"
	ColumnLatestEpisodeAt = "latest_episode_at"
)

// Order is a sort order resolved into what the scans need: the column to sort
// by, and whether the list runs down or up that column. Name is what a token
// calls it.
type Order struct {
	Name       string
	Column     string
	Descending bool
}

var (
	PublishedAtDesc     = Order{Name: "published_at_desc", Column: ColumnPublishedAt, Descending: true}
	PublishedAtAsc      = Order{Name: "published_at_asc", Column: ColumnPublishedAt}
	TitleAsc            = Order{Name: "title_asc", Column: ColumnTitle}
	TitleDesc           = Order{Name: "title_desc", Column: ColumnTitle, Descending: true}
	LatestEpisodeAtDesc = Order{Name: "latest_episode_at_desc", Column: ColumnLatestEpisodeAt, Descending: true}
)

// Filter is what a list was narrowed by, beyond the tenant and the publication
// state every one of them applies. Each field is already in the shape the
// scans take.
type Filter struct {
	// Keep only the series that have a free episode at the moment of the read.
	HasFreeEpisodes bool
	// The public ID of the one genre to keep. Invalid means no genre filter.
	GenrePublicID sql.NullString
	// The slug of the one tag to keep. Invalid means no tag filter.
	TagSlug sql.NullString
	// The stored serialization status to keep. Invalid means no status filter.
	Status sql.NullString
	// The EXTRACT(DOW) weekday a kept series expects an episode on. Invalid
	// means no weekday filter; 0 is Sunday, which is why this is not an int16
	// with a zero that could mean either.
	Weekday sql.NullInt16
}

// ListKey names the list a token points into. A boundary row sits at another
// position once the list is filtered differently, exactly as it does under
// another order, so the filters ride in the same key as the order name and a
// list with no filter keeps the plain order name it always carried.
//
// The filters are appended in a fixed order rather than in the order the
// request happened to carry them, so the same narrowed list always names
// itself the same way.
func ListKey(order Order, filter Filter) string {
	key := order.Name
	if filter.HasFreeEpisodes {
		key += "+has_free_episodes"
	}
	if filter.GenrePublicID.Valid {
		key += "+genre:" + filter.GenrePublicID.String
	}
	if filter.TagSlug.Valid {
		key += "+tag:" + filter.TagSlug.String
	}
	if filter.Status.Valid {
		key += "+status:" + filter.Status.String
	}
	if filter.Weekday.Valid {
		key += "+weekday:" + strconv.FormatInt(int64(filter.Weekday.Int16), 10)
	}
	return key
}

// Keys is the boundary row a token names, in the shape the scans compare
// against. Only the column of the order and the id are read; the zero value is
// the first page.
type Keys struct {
	PublishedAt     sql.NullTime
	Title           sql.NullString
	LatestEpisodeAt sql.NullTime
	ID              uuid.NullUUID
	Inclusive       bool
}

// Row is one series of a page with the value the scan sorted it by. Only the
// field of the order's column is set.
type Row struct {
	ID              uuid.UUID
	PublishedAt     time.Time
	Title           string
	LatestEpisodeAt time.Time
}

// Scan is one page of one list.
type Scan struct {
	TenantID uuid.UUID
	Surface  string
	Order    Order
	Filter   Filter
	// QueryPattern narrows the list to the series whose title or synopsis
	// ILIKE-matches it, with '!' as the escape character. Invalid is a list
	// rather than a search.
	QueryPattern sql.NullString
	// Descending is the direction actually scanned: the sort order and the
	// page direction folded together.
	Descending bool
	Keys       Keys
	Limit      int32
}

// Page runs the scan. The sort order lives in the query rather than in a
// parameter so each one reads its index in order and stops at LIMIT; a CASE
// in ORDER BY would sort the whole tenant first.
func Page(ctx context.Context, queries dbmodels.Querier, scan Scan) ([]Row, error) {
	filter, keys := scan.Filter, scan.Keys
	switch {
	case scan.Order.Column == ColumnLatestEpisodeAt && scan.Descending:
		rows, err := queries.ListActiveSeriesIDsByLatestEpisodeAtDesc(ctx, dbmodels.ListActiveSeriesIDsByLatestEpisodeAtDescParams{
			TenantID:              scan.TenantID,
			Surface:               scan.Surface,
			HasFreeEpisodes:       filter.HasFreeEpisodes,
			GenrePublicID:         filter.GenrePublicID,
			TagSlug:               filter.TagSlug,
			Status:                filter.Status,
			Weekday:               filter.Weekday,
			QueryPattern:          scan.QueryPattern,
			CursorLatestEpisodeAt: keys.LatestEpisodeAt,
			CursorID:              keys.ID,
			CursorInclusive:       keys.Inclusive,
			Limit:                 scan.Limit,
		})
		return rowsOf(rows, func(row dbmodels.ListActiveSeriesIDsByLatestEpisodeAtDescRow) Row {
			return Row{ID: row.ID, LatestEpisodeAt: row.LatestEpisodeAt}
		}), err
	case scan.Order.Column == ColumnLatestEpisodeAt:
		rows, err := queries.ListActiveSeriesIDsByLatestEpisodeAtAsc(ctx, dbmodels.ListActiveSeriesIDsByLatestEpisodeAtAscParams{
			TenantID:              scan.TenantID,
			Surface:               scan.Surface,
			HasFreeEpisodes:       filter.HasFreeEpisodes,
			GenrePublicID:         filter.GenrePublicID,
			TagSlug:               filter.TagSlug,
			Status:                filter.Status,
			Weekday:               filter.Weekday,
			QueryPattern:          scan.QueryPattern,
			CursorLatestEpisodeAt: keys.LatestEpisodeAt,
			CursorID:              keys.ID,
			CursorInclusive:       keys.Inclusive,
			Limit:                 scan.Limit,
		})
		return rowsOf(rows, func(row dbmodels.ListActiveSeriesIDsByLatestEpisodeAtAscRow) Row {
			return Row{ID: row.ID, LatestEpisodeAt: row.LatestEpisodeAt}
		}), err
	case scan.Order.Column == ColumnTitle && scan.Descending:
		rows, err := queries.ListActiveSeriesIDsByTitleDesc(ctx, dbmodels.ListActiveSeriesIDsByTitleDescParams{
			TenantID:        scan.TenantID,
			Surface:         scan.Surface,
			HasFreeEpisodes: filter.HasFreeEpisodes,
			GenrePublicID:   filter.GenrePublicID,
			TagSlug:         filter.TagSlug,
			Status:          filter.Status,
			Weekday:         filter.Weekday,
			QueryPattern:    scan.QueryPattern,
			CursorTitle:     keys.Title,
			CursorID:        keys.ID,
			CursorInclusive: keys.Inclusive,
			Limit:           scan.Limit,
		})
		return rowsOf(rows, func(row dbmodels.ListActiveSeriesIDsByTitleDescRow) Row {
			return Row{ID: row.ID, Title: row.Title}
		}), err
	case scan.Order.Column == ColumnTitle:
		rows, err := queries.ListActiveSeriesIDsByTitleAsc(ctx, dbmodels.ListActiveSeriesIDsByTitleAscParams{
			TenantID:        scan.TenantID,
			Surface:         scan.Surface,
			HasFreeEpisodes: filter.HasFreeEpisodes,
			GenrePublicID:   filter.GenrePublicID,
			TagSlug:         filter.TagSlug,
			Status:          filter.Status,
			Weekday:         filter.Weekday,
			QueryPattern:    scan.QueryPattern,
			CursorTitle:     keys.Title,
			CursorID:        keys.ID,
			CursorInclusive: keys.Inclusive,
			Limit:           scan.Limit,
		})
		return rowsOf(rows, func(row dbmodels.ListActiveSeriesIDsByTitleAscRow) Row {
			return Row{ID: row.ID, Title: row.Title}
		}), err
	case scan.Descending:
		rows, err := queries.ListActiveSeriesIDsByPublishedAtDesc(ctx, dbmodels.ListActiveSeriesIDsByPublishedAtDescParams{
			TenantID:          scan.TenantID,
			Surface:           scan.Surface,
			HasFreeEpisodes:   filter.HasFreeEpisodes,
			GenrePublicID:     filter.GenrePublicID,
			TagSlug:           filter.TagSlug,
			Status:            filter.Status,
			Weekday:           filter.Weekday,
			QueryPattern:      scan.QueryPattern,
			CursorPublishedAt: keys.PublishedAt,
			CursorID:          keys.ID,
			CursorInclusive:   keys.Inclusive,
			Limit:             scan.Limit,
		})
		return rowsOf(rows, func(row dbmodels.ListActiveSeriesIDsByPublishedAtDescRow) Row {
			return Row{ID: row.ID, PublishedAt: row.PublishedAt.Time}
		}), err
	default:
		rows, err := queries.ListActiveSeriesIDsByPublishedAtAsc(ctx, dbmodels.ListActiveSeriesIDsByPublishedAtAscParams{
			TenantID:          scan.TenantID,
			Surface:           scan.Surface,
			HasFreeEpisodes:   filter.HasFreeEpisodes,
			GenrePublicID:     filter.GenrePublicID,
			TagSlug:           filter.TagSlug,
			Status:            filter.Status,
			Weekday:           filter.Weekday,
			QueryPattern:      scan.QueryPattern,
			CursorPublishedAt: keys.PublishedAt,
			CursorID:          keys.ID,
			CursorInclusive:   keys.Inclusive,
			Limit:             scan.Limit,
		})
		return rowsOf(rows, func(row dbmodels.ListActiveSeriesIDsByPublishedAtAscRow) Row {
			return Row{ID: row.ID, PublishedAt: row.PublishedAt.Time}
		}), err
	}
}

func rowsOf[T any](rows []T, convert func(T) Row) []Row {
	page := make([]Row, len(rows))
	for index, row := range rows {
		page[index] = convert(row)
	}
	return page
}
