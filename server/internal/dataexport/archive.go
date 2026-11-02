package dataexport

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"

	"github.com/publira/publira/server/internal/csvexport"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/locale"
)

// The files of an archive, one per kind of record, in the order they are
// written. A kind the reader has no record of is still written, as an empty
// list or a null, so the archive says the install keeps none rather than
// leaving the reader to guess whether it was left out.
const (
	FileAccount          = "account.json"
	FileSignInMethods    = "sign_in_methods.json"
	FileFollows          = "follows.json"
	FileReadingPositions = "reading_positions.json"
	FileReadingHistory   = "reading_history.json"
	FileRatings          = "ratings.json"
	FileComments         = "comments.json"
	FileCommentReports   = "comment_reports.json"
	FilePurchases        = "purchases.json"
	FilePurchasesCSV     = "purchases.csv"
	FileCoinTransactions = "coin_transactions.json"
	FileSubscriptions    = "subscriptions.json"
	FilePreferences      = "preferences.json"
	FileLegalPageConsent = "legal_page_consents.json"
	FileAccessTickets    = "access_tickets.json"
	FileContactMessages  = "contact_messages.json"
)

// ErrAccountNotFound is what Build answers for a reader the tenant no longer
// holds.
var ErrAccountNotFound = errors.New("the account to export does not exist")

// Build reads every record the install keeps about one reader of one tenant
// and writes them into a ZIP, the titles in loc. Times are RFC 3339 in UTC.
func Build(ctx context.Context, q dbmodels.Querier, tenantID, userID uuid.UUID, loc string) ([]byte, error) {
	files, err := collect(ctx, q, tenantID, userID, loc)
	if err != nil {
		return nil, err
	}
	var buf bytes.Buffer
	archive := zip.NewWriter(&buf)
	for _, file := range files {
		w, err := archive.Create(file.name)
		if err != nil {
			return nil, fmt.Errorf("add %s to the archive: %w", file.name, err)
		}
		if _, err := w.Write(file.data); err != nil {
			return nil, fmt.Errorf("write %s to the archive: %w", file.name, err)
		}
	}
	if err := archive.Close(); err != nil {
		return nil, fmt.Errorf("close the archive: %w", err)
	}
	return buf.Bytes(), nil
}

type archiveFile struct {
	name string
	data []byte
}

// collect reads each kind of record in turn. Each read is a query of its own
// rather than one transaction: a record written between two of them is in
// the next archive, which is all a reader asking for a copy is owed.
func collect(ctx context.Context, q dbmodels.Querier, tenantID, userID uuid.UUID, loc string) ([]archiveFile, error) {
	var files []archiveFile
	add := func(name string, value any) error {
		data, err := json.MarshalIndent(value, "", "  ")
		if err != nil {
			return fmt.Errorf("encode %s: %w", name, err)
		}
		files = append(files, archiveFile{name: name, data: append(data, '\n')})
		return nil
	}

	account, err := q.GetUserForDataExport(ctx, dbmodels.GetUserForDataExportParams{TenantID: uuid.NullUUID{UUID: tenantID, Valid: true}, UserID: userID})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrAccountNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read the account: %w", err)
	}
	if err := add(FileAccount, accountRecord{
		PublicID:        account.PublicID,
		Email:           account.Email,
		Name:            account.Name,
		Status:          account.Status,
		CreatedAt:       instant(account.CreatedAt),
		EmailVerifiedAt: nullInstant(account.EmailVerifiedAt),
		BirthDate:       nullDate(account.BirthDate),
		Locale:          nullString(account.LastLocale),
	}); err != nil {
		return nil, err
	}

	identities, err := q.ListUserIdentitiesForDataExport(ctx, dbmodels.ListUserIdentitiesForDataExportParams{TenantID: tenantID, UserID: userID})
	if err != nil {
		return nil, fmt.Errorf("read the linked sign-ins: %w", err)
	}
	passkeys, err := q.ListUserPasskeysForDataExport(ctx, dbmodels.ListUserPasskeysForDataExportParams{TenantID: tenantID, UserID: userID})
	if err != nil {
		return nil, fmt.Errorf("read the passkeys: %w", err)
	}
	methods := signInMethodsRecord{
		Password:         account.HasPassword,
		TwoFactorEnabled: nullInstant(account.MfaEnabledAt),
		LinkedAccounts:   make([]linkedAccountRecord, 0, len(identities)),
		Passkeys:         make([]passkeyRecord, 0, len(passkeys)),
	}
	for _, identity := range identities {
		methods.LinkedAccounts = append(methods.LinkedAccounts, linkedAccountRecord{
			Provider: identity.Provider,
			Email:    identity.EmailAtLink,
			LinkedAt: instant(identity.CreatedAt),
		})
	}
	for _, passkey := range passkeys {
		methods.Passkeys = append(methods.Passkeys, passkeyRecord{
			ID:           passkey.PublicID,
			Name:         passkey.Name,
			RelyingParty: passkey.RelyingParty,
			CreatedAt:    instant(passkey.CreatedAt),
			LastUsedAt:   nullInstant(passkey.LastUsedAt),
		})
	}
	if err := add(FileSignInMethods, methods); err != nil {
		return nil, err
	}

	follows, err := q.ListFollowsForDataExport(ctx, dbmodels.ListFollowsForDataExportParams{Locale: loc, TenantID: tenantID, UserID: userID})
	if err != nil {
		return nil, fmt.Errorf("read the follows: %w", err)
	}
	followRecords := make([]followRecord, 0, len(follows))
	for _, follow := range follows {
		followRecords = append(followRecords, followRecord{
			Kind:       follow.Kind,
			ID:         follow.PublicID,
			Name:       follow.Name,
			FollowedAt: instant(follow.CreatedAt),
		})
	}
	if err := add(FileFollows, followRecords); err != nil {
		return nil, err
	}

	positions, err := q.ListReadingPositionsForDataExport(ctx, dbmodels.ListReadingPositionsForDataExportParams{Locale: loc, TenantID: tenantID, UserID: userID})
	if err != nil {
		return nil, fmt.Errorf("read the reading positions: %w", err)
	}
	positionRecords := make([]readingPositionRecord, 0, len(positions))
	for _, position := range positions {
		positionRecords = append(positionRecords, readingPositionRecord{
			episodeRef: episodeRef{
				SeriesID:      position.SeriesPublicID,
				SeriesTitle:   position.SeriesTitle,
				EpisodeID:     position.EpisodePublicID,
				EpisodeTitle:  position.EpisodeTitle,
				EpisodeNumber: position.EpisodeOrderIndex,
			},
			PageIndex: position.PageIndex,
			PageCount: position.PageCount,
			UpdatedAt: instant(position.UpdatedAt),
		})
	}
	if err := add(FileReadingPositions, positionRecords); err != nil {
		return nil, err
	}

	reads, err := q.ListEpisodeReadsForDataExport(ctx, dbmodels.ListEpisodeReadsForDataExportParams{Locale: loc, TenantID: tenantID, UserID: userID})
	if err != nil {
		return nil, fmt.Errorf("read the reading history: %w", err)
	}
	readRecords := make([]episodeReadRecord, 0, len(reads))
	for _, read := range reads {
		readRecords = append(readRecords, episodeReadRecord{
			episodeRef: episodeRef{
				SeriesID:      read.SeriesPublicID,
				SeriesTitle:   read.SeriesTitle,
				EpisodeID:     read.EpisodePublicID,
				EpisodeTitle:  read.EpisodeTitle,
				EpisodeNumber: read.EpisodeOrderIndex,
			},
			ReadAt: instant(read.ReadAt),
		})
	}
	if err := add(FileReadingHistory, readRecords); err != nil {
		return nil, err
	}

	ratings, err := q.ListEpisodeRatingsForDataExport(ctx, dbmodels.ListEpisodeRatingsForDataExportParams{Locale: loc, TenantID: tenantID, UserID: userID})
	if err != nil {
		return nil, fmt.Errorf("read the ratings: %w", err)
	}
	ratingRecords := make([]ratingRecord, 0, len(ratings))
	for _, rating := range ratings {
		ratingRecords = append(ratingRecords, ratingRecord{
			episodeRef: episodeRef{
				SeriesID:      rating.SeriesPublicID,
				SeriesTitle:   rating.SeriesTitle,
				EpisodeID:     rating.EpisodePublicID,
				EpisodeTitle:  rating.EpisodeTitle,
				EpisodeNumber: rating.EpisodeOrderIndex,
			},
			Score:   rating.Score,
			RatedAt: instant(rating.CreatedAt),
		})
	}
	if err := add(FileRatings, ratingRecords); err != nil {
		return nil, err
	}

	comments, err := q.ListEpisodeCommentsForDataExport(ctx, dbmodels.ListEpisodeCommentsForDataExportParams{Locale: loc, TenantID: tenantID, UserID: userID})
	if err != nil {
		return nil, fmt.Errorf("read the comments: %w", err)
	}
	commentRecords := make([]commentRecord, 0, len(comments))
	for _, comment := range comments {
		commentRecords = append(commentRecords, commentRecord{
			ID: comment.PublicID,
			episodeRef: episodeRef{
				SeriesID:      comment.SeriesPublicID,
				SeriesTitle:   comment.SeriesTitle,
				EpisodeID:     comment.EpisodePublicID,
				EpisodeTitle:  comment.EpisodeTitle,
				EpisodeNumber: comment.EpisodeOrderIndex,
			},
			Body:         comment.Body,
			Status:       comment.Status,
			HiddenReason: nullString(comment.HiddenReason),
			PostedAt:     instant(comment.CreatedAt),
			PublishedAt:  nullInstant(comment.PublishedAt),
			HiddenAt:     nullInstant(comment.HiddenAt),
			WithdrawnAt:  nullInstant(comment.WithdrawnAt),
		})
	}
	if err := add(FileComments, commentRecords); err != nil {
		return nil, err
	}

	reports, err := q.ListEpisodeCommentReportsForDataExport(ctx, dbmodels.ListEpisodeCommentReportsForDataExportParams{TenantID: tenantID, UserID: userID})
	if err != nil {
		return nil, fmt.Errorf("read the comment reports: %w", err)
	}
	reportRecords := make([]commentReportRecord, 0, len(reports))
	for _, report := range reports {
		reportRecords = append(reportRecords, commentReportRecord{
			CommentID:  report.CommentPublicID,
			Reason:     report.Reason,
			Note:       nullString(report.Note),
			Status:     report.Status,
			ReportedAt: instant(report.CreatedAt),
			ResolvedAt: nullInstant(report.ResolvedAt),
		})
	}
	if err := add(FileCommentReports, reportRecords); err != nil {
		return nil, err
	}

	purchases, err := q.ListPurchasesForDataExport(ctx, dbmodels.ListPurchasesForDataExportParams{Locale: loc, TenantID: tenantID, UserID: userID})
	if err != nil {
		return nil, fmt.Errorf("read the purchases: %w", err)
	}
	purchaseRecords, csv, err := purchaseFiles(purchases, time.Now())
	if err != nil {
		return nil, err
	}
	if err := add(FilePurchases, purchaseRecords); err != nil {
		return nil, err
	}
	files = append(files, archiveFile{name: FilePurchasesCSV, data: csv})

	coins, err := q.ListCoinTransactionsForDataExport(ctx, dbmodels.ListCoinTransactionsForDataExportParams{TenantID: tenantID, UserID: userID})
	if err != nil {
		return nil, fmt.Errorf("read the coin transactions: %w", err)
	}
	coinRecords := make([]coinTransactionRecord, 0, len(coins))
	for _, coin := range coins {
		record := coinTransactionRecord{Kind: coin.Kind, Coins: coin.Coins, CreatedAt: instant(coin.CreatedAt)}
		if coin.PurchaseID.Valid {
			id := coin.PurchaseID.UUID.String()
			record.PurchaseID = &id
		}
		coinRecords = append(coinRecords, record)
	}
	if err := add(FileCoinTransactions, coinRecords); err != nil {
		return nil, err
	}

	subscriptions, err := q.ListSubscriptionsForDataExport(ctx, dbmodels.ListSubscriptionsForDataExportParams{TenantID: tenantID, UserID: userID})
	if err != nil {
		return nil, fmt.Errorf("read the subscriptions: %w", err)
	}
	subscriptionRecords := make([]subscriptionRecord, 0, len(subscriptions))
	for _, subscription := range subscriptions {
		subscriptionRecords = append(subscriptionRecords, subscriptionRecord{
			PlanID:            subscription.PlanPublicID,
			PlanName:          subscription.PlanName,
			Provider:          subscription.Provider,
			Status:            subscription.Status,
			CurrentPeriodEnd:  nullInstant(subscription.CurrentPeriodEnd),
			CancelAtPeriodEnd: subscription.CancelAtPeriodEnd,
			StartedAt:         instant(subscription.CreatedAt),
			UpdatedAt:         instant(subscription.UpdatedAt),
		})
	}
	if err := add(FileSubscriptions, subscriptionRecords); err != nil {
		return nil, err
	}

	var preferences preferencesRecord
	notificationSettings, err := q.GetNotificationSettingsForDataExport(ctx, dbmodels.GetNotificationSettingsForDataExportParams{TenantID: tenantID, UserID: userID})
	switch {
	case err == nil:
		preferences.NotificationSettings = notificationSettingsFrom(notificationSettings)
	case !errors.Is(err, sql.ErrNoRows):
		return nil, fmt.Errorf("read the notification settings: %w", err)
	}
	viewer, err := q.GetViewerPreferencesForDataExport(ctx, dbmodels.GetViewerPreferencesForDataExportParams{TenantID: tenantID, UserID: userID})
	switch {
	case err == nil:
		preferences.ViewerPreferences = &viewerPreferencesRecord{WideViewer: viewer.WideViewerEnabled, UpdatedAt: instant(viewer.UpdatedAt)}
	case !errors.Is(err, sql.ErrNoRows):
		return nil, fmt.Errorf("read the viewer preferences: %w", err)
	}
	if err := add(FilePreferences, preferences); err != nil {
		return nil, err
	}

	consents, err := q.ListPageConsentsForDataExport(ctx, dbmodels.ListPageConsentsForDataExportParams{TenantID: tenantID, UserID: userID})
	if err != nil {
		return nil, fmt.Errorf("read the legal page agreements: %w", err)
	}
	consentRecords := make([]legalPageConsentRecord, 0, len(consents))
	for _, consent := range consents {
		consentRecords = append(consentRecords, legalPageConsentRecord{
			Page:     consent.Slug,
			Title:    consent.Title,
			Locale:   consent.Locale,
			Version:  consent.VersionNumber,
			AgreedAt: instant(consent.AgreedAt),
		})
	}
	if err := add(FileLegalPageConsent, consentRecords); err != nil {
		return nil, err
	}

	tickets, err := q.ListAccessTicketsForDataExport(ctx, dbmodels.ListAccessTicketsForDataExportParams{Locale: loc, TenantID: tenantID, UserID: userID})
	if err != nil {
		return nil, fmt.Errorf("read the access tickets: %w", err)
	}
	ticketRecords := make([]accessTicketRecord, 0, len(tickets))
	for _, ticket := range tickets {
		ticketRecords = append(ticketRecords, accessTicketRecord{
			ID: ticket.PublicID,
			episodeRef: episodeRef{
				SeriesID:      ticket.SeriesPublicID,
				SeriesTitle:   ticket.SeriesTitle,
				EpisodeID:     ticket.EpisodePublicID,
				EpisodeTitle:  ticket.EpisodeTitle,
				EpisodeNumber: ticket.EpisodeOrderIndex,
			},
			Source:    ticket.Source,
			GrantedAt: instant(ticket.CreatedAt),
			ExpiresAt: nullInstant(ticket.ExpiresAt),
			RevokedAt: nullInstant(ticket.RevokedAt),
		})
	}
	if err := add(FileAccessTickets, ticketRecords); err != nil {
		return nil, err
	}

	messages, err := q.ListContactMessagesForDataExport(ctx, dbmodels.ListContactMessagesForDataExportParams{TenantID: tenantID, UserID: userID})
	if err != nil {
		return nil, fmt.Errorf("read the contact messages: %w", err)
	}
	messageRecords := make([]contactMessageRecord, 0, len(messages))
	if len(messages) > 0 {
		ids := make([]uuid.UUID, 0, len(messages))
		for _, message := range messages {
			ids = append(ids, message.ID)
		}
		entries, err := q.ListContactMessageEntriesForDataExport(ctx, dbmodels.ListContactMessageEntriesForDataExportParams{TenantID: tenantID, ContactMessageIds: ids})
		if err != nil {
			return nil, fmt.Errorf("read the contact message replies: %w", err)
		}
		replies := make(map[uuid.UUID][]contactReplyRecord, len(messages))
		for _, entry := range entries {
			replies[entry.ContactMessageID] = append(replies[entry.ContactMessageID], contactReplyRecord{
				From:      entry.Direction,
				FromEmail: nullString(entry.FromEmail),
				Body:      entry.Body,
				SentAt:    instant(entry.CreatedAt),
			})
		}
		for _, message := range messages {
			record := contactMessageRecord{
				ID:           message.PublicID,
				ReplyToEmail: message.ReplyToEmail,
				Subject:      nullString(message.Subject),
				Body:         message.Body,
				SentAt:       instant(message.CreatedAt),
				HandledAt:    nullInstant(message.HandledAt),
				Replies:      replies[message.ID],
			}
			if record.Replies == nil {
				record.Replies = []contactReplyRecord{}
			}
			messageRecords = append(messageRecords, record)
		}
	}
	if err := add(FileContactMessages, messageRecords); err != nil {
		return nil, err
	}

	return files, nil
}

// purchaseHeader is the header of the purchase history CSV the storefront's
// own download writes, so a reader's sheet reads either file the same way.
var purchaseHeader = []string{
	"purchase_id", "purchased_at", "series_title", "episode_number", "episode_title",
	"price", "refunded_amount", "currency", "expires_at", "refunded_at", "status",
	"item", "volume_title", "coins", "bonus_coins", "coins_spent",
}

// purchaseFiles words each purchase the way the library does, as JSON and as
// the purchase history CSV.
func purchaseFiles(rows []dbmodels.ListPurchasesForDataExportRow, now time.Time) ([]purchaseRecord, []byte, error) {
	records := make([]purchaseRecord, 0, len(rows))
	csv := csvexport.New(purchaseHeader...)
	for _, row := range rows {
		digits, err := locale.CurrencyDigits(row.Currency)
		if err != nil {
			return nil, nil, fmt.Errorf("purchase %s: %w", row.ID, err)
		}
		price, refunded := int64(row.PriceAtPurchase), int64(row.RefundedAmount.Int32)
		// A purchase paid with coins records what its coins were worth as the
		// tenant's sale, which the reader did not pay, as the library says.
		if row.CoinsSpent > 0 {
			price, refunded = 0, 0
		}
		record := purchaseRecord{
			ID:             row.ID.String(),
			Kind:           row.Kind,
			Item:           purchaseItem(row),
			Status:         purchaseStatus(row, now),
			PurchasedAt:    instant(row.PurchasedAt),
			Currency:       row.Currency,
			Price:          formatAmount(price, digits),
			RefundedAmount: formatAmount(refunded, digits),
			ExpiresAt:      nullInstant(row.ExpiresAt),
			RefundedAt:     nullInstant(row.RefundedAt),
			RevokedAt:      nullInstant(row.RevokedAt),
			PaidThrough:    paidThrough(row),
			SeriesID:       nullString(row.SeriesPublicID),
			SeriesTitle:    emptyAsNull(row.SeriesTitle),
		}
		episodeNumber, episodeTitle, volumeTitle, coins, bonusCoins, coinsSpent := "", "", "", "", "", ""
		switch record.Item {
		case "episode":
			record.EpisodeID = nullString(row.EpisodePublicID)
			record.EpisodeTitle = emptyAsNull(row.EpisodeTitle)
			if row.EpisodeOrderIndex.Valid {
				number := row.EpisodeOrderIndex.Int32
				record.EpisodeNumber = &number
				episodeNumber = strconv.Itoa(int(number))
			}
			episodeTitle = row.EpisodeTitle
		case "volume":
			record.VolumeID = nullString(row.VolumePublicID)
			record.VolumeTitle = nullString(row.VolumeTitle)
			volumeTitle = row.VolumeTitle.String
		case "coin_pack":
			total, bonus := row.CoinPackCoins.Int32+row.CoinPackBonusCoins.Int32, row.CoinPackBonusCoins.Int32
			record.CoinPackID = nullString(row.CoinPackPublicID)
			record.Coins = &total
			record.BonusCoins = &bonus
			coins, bonusCoins = strconv.Itoa(int(total)), strconv.Itoa(int(bonus))
		}
		if row.CoinsSpent > 0 {
			spent := row.CoinsSpent
			record.CoinsSpent = &spent
			coinsSpent = strconv.Itoa(int(spent))
		}
		records = append(records, record)
		csv.Row(
			record.ID,
			record.PurchasedAt,
			row.SeriesTitle,
			episodeNumber,
			episodeTitle,
			record.Price,
			record.RefundedAmount,
			row.Currency,
			valueOrEmpty(record.ExpiresAt),
			valueOrEmpty(record.RefundedAt),
			record.Status,
			record.Item,
			volumeTitle,
			coins,
			bonusCoins,
			coinsSpent,
		)
	}
	return records, csv.Bytes(), nil
}

// purchaseItem is what a purchase bought, as the CSV's item column names it.
// The rest of a series is remaining_episodes, which is what the reader bought
// it as.
func purchaseItem(row dbmodels.ListPurchasesForDataExportRow) string {
	switch {
	case row.CoinPackPublicID.Valid:
		return "coin_pack"
	case row.VolumePublicID.Valid:
		return "volume"
	case row.SeriesBundleID.Valid:
		return "remaining_episodes"
	default:
		return "episode"
	}
}

// purchaseStatus is the badge the library shows a purchase under.
func purchaseStatus(row dbmodels.ListPurchasesForDataExportRow, now time.Time) string {
	switch {
	case row.RefundedAt.Valid:
		return "refunded"
	case row.RevokedAt.Valid:
		return "canceled"
	case row.ExpiresAt.Valid && !row.ExpiresAt.Time.After(now):
		return "expired"
	default:
		return "active"
	}
}

// paidThrough names the payment provider or the store the reader paid
// through, and is null for a purchase paid with coins.
func paidThrough(row dbmodels.ListPurchasesForDataExportRow) *string {
	if row.Store.Valid {
		return &row.Store.String
	}
	return nullString(row.Provider)
}

// formatAmount writes an amount in the minor unit of its currency in the
// currency itself, with no symbol and no grouping: 500 is 500 in JPY and 5.00
// in USD.
func formatAmount(amount int64, digits int) string {
	if digits == 0 {
		return strconv.FormatInt(amount, 10)
	}
	scale := int64(1)
	for range digits {
		scale *= 10
	}
	fraction := strconv.FormatInt(amount%scale, 10)
	for len(fraction) < digits {
		fraction = "0" + fraction
	}
	return strconv.FormatInt(amount/scale, 10) + "." + fraction
}

func notificationSettingsFrom(s dbmodels.UserNotificationSetting) *notificationSettingsRecord {
	return &notificationSettingsRecord{
		FollowedEpisodes: channelsRecord{Inbox: s.FollowedEpisodesInboxEnabled, Email: s.FollowedEpisodesEmailEnabled, WebPush: s.FollowedEpisodesWebPushEnabled, MobilePush: s.FollowedEpisodesMobilePushEnabled},
		FollowedCreators: channelsRecord{Inbox: s.FollowedCreatorsInboxEnabled, Email: s.FollowedCreatorsEmailEnabled, WebPush: s.FollowedCreatorsWebPushEnabled, MobilePush: s.FollowedCreatorsMobilePushEnabled},
		Comments:         channelsRecord{Inbox: s.CommentsInboxEnabled, Email: s.CommentsEmailEnabled},
		Announcements:    channelsRecord{Inbox: s.AnnouncementsInboxEnabled, Email: s.AnnouncementsEmailEnabled, WebPush: s.AnnouncementsWebPushEnabled, MobilePush: s.AnnouncementsMobilePushEnabled},
		UpdatedAt:        instant(s.UpdatedAt),
	}
}

func instant(t time.Time) string {
	return t.UTC().Format(time.RFC3339)
}

func nullInstant(t sql.NullTime) *string {
	if !t.Valid {
		return nil
	}
	written := instant(t.Time)
	return &written
}

func nullDate(t sql.NullTime) *string {
	if !t.Valid {
		return nil
	}
	written := t.Time.Format(time.DateOnly)
	return &written
}

func nullString(s sql.NullString) *string {
	if !s.Valid {
		return nil
	}
	return &s.String
}

func emptyAsNull(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func valueOrEmpty(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
