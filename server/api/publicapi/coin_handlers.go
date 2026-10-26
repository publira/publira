package publicapi

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"strconv"
	"time"
	"unicode/utf8"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	"github.com/publira/publira/server/api/protomapper"
	dbmodels "github.com/publira/publira/server/internal/db/gen"
	"github.com/publira/publira/server/internal/pagination"
	"github.com/publira/publira/server/internal/paymentprovider"
	publirattypesv1 "github.com/publira/publira/server/internal/proto/gen/publira/types/v1"
	publirav1 "github.com/publira/publira/server/internal/proto/gen/publira/v1"
	"github.com/publira/publira/server/internal/rpcerrors"
	"github.com/publira/publira/server/internal/rpcmiddleware"
)

const (
	defaultCoinTransactionPageSize = int32(20)
	maxCoinTransactionPageSize     = int32(100)

	// maxCoinIdempotencyKeyRunes is the column's own bound on the key a
	// client names a payment by.
	maxCoinIdempotencyKeyRunes = 200
)

var (
	errCoinsUnavailable       = errors.New("the tenant does not offer coins")
	errCoinPriceChanged       = errors.New("the episode's coin price is not the one the reader was shown")
	errCoinBalanceTooLow      = errors.New("the reader does not hold enough coins")
	errCoinIdempotencyKeyUsed = errors.New("idempotency_key already paid for another episode or kind")
	errCoinSpendTooValuable   = errors.New("the coins spent are worth more than a purchase's price can hold")
)

// coinOffer is what a request is told about the tenant's coins. Nothing about
// coins reaches a reader unless offered is true: the platform allows tenant
// coins and the tenant has turned its own on.
type coinOffer struct {
	offered bool
	// unitAmount is what one coin is worth in the minor unit of the tenant's
	// currency, and name the tenant's word for its coins in the locale asked
	// for.
	unitAmount int32
	name       string
	settings   dbmodels.GetTenantCoinOfferRow
}

// tenantCoinOffer reads the tenant's coins as a reader in locale is to see
// them. While the platform does not allow tenant coins, nothing is read and
// nothing is offered. Only coinNameFor wants the name of coins the platform
// has stopped, and it reads the settings whatever the policy says.
func (s *apiServer) tenantCoinOffer(ctx context.Context, tenantID uuid.UUID, locale string) (coinOffer, error) {
	policy, err := s.readerPolicy(ctx)
	if err != nil {
		return coinOffer{}, err
	}
	if !policy.TenantCoinsAllowed {
		return coinOffer{}, nil
	}
	offer, err := s.readCoinOffer(ctx, tenantID, locale)
	if err != nil {
		return coinOffer{}, err
	}
	offer.offered = offer.settings.Enabled && offer.settings.CoinUnitAmount.Valid
	if offer.offered {
		offer.unitAmount = offer.settings.CoinUnitAmount.Int32
	}
	return offer, nil
}

// readCoinOffer reads the tenant's coin settings and the coin's name in
// locale, offering nothing. A tenant that has saved nothing reads as nothing.
func (s *apiServer) readCoinOffer(ctx context.Context, tenantID uuid.UUID, locale string) (coinOffer, error) {
	settings, err := s.queriesFor(ctx).GetTenantCoinOffer(ctx, dbmodels.GetTenantCoinOfferParams{
		TenantID: tenantID,
		Locale:   locale,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return coinOffer{}, nil
	}
	if err != nil {
		return coinOffer{}, s.internalDBError(ctx, "failed to read the tenant's coins", err, "tenant_id", tenantID.String())
	}
	return coinOffer{name: settings.CoinName, settings: settings}, nil
}

// requireCoinOffer answers the tenant's coins, or refuses the RPC while they
// are not offered.
func (s *apiServer) requireCoinOffer(ctx context.Context, tenantID uuid.UUID, locale string) (coinOffer, error) {
	offer, err := s.tenantCoinOffer(ctx, tenantID, locale)
	if err != nil {
		return coinOffer{}, err
	}
	if !offer.offered {
		return coinOffer{}, coinsUnavailableError()
	}
	return offer, nil
}

func coinsUnavailableError() error {
	return rpcerrors.NewErrorInfoError(connect.CodeFailedPrecondition, errCoinsUnavailable, rpcerrors.ReasonCoinsUnavailable)
}

// coinNameFor answers the tenant's word for its coins in locale, which a
// purchase paid with coins is named in whether or not the tenant still offers
// them. Empty when the tenant has named its coins in no locale.
func (s *apiServer) coinNameFor(ctx context.Context, tenantID uuid.UUID, locale string) (string, error) {
	offer, err := s.readCoinOffer(ctx, tenantID, locale)
	if err != nil {
		return "", err
	}
	return offer.name, nil
}

// coinPriceOf is what a price in the tenant's currency costs in coins worth
// unitAmount each, rounded up so that the coins spent are always worth at
// least the price.
func coinPriceOf(price, unitAmount int32) int32 {
	return int32((int64(price) + int64(unitAmount) - 1) / int64(unitAmount))
}

// setEpisodeCoinPrices puts the episode's prices in coins onto it, from the
// prices it already carries, while the tenant offers coins. The permanent
// copy is priced at its campaign price while a campaign is open, as a
// checkout charges it.
func setEpisodeCoinPrices(episode *publirattypesv1.Episode, offer coinOffer) {
	if !offer.offered || episode.Price <= 0 {
		return
	}
	price := episode.Price
	if episode.CampaignPrice > 0 {
		price = episode.CampaignPrice
	}
	episode.CoinPrice = coinPriceOf(price, offer.unitAmount)
	if episode.RentalPrice > 0 {
		episode.CoinRentalPrice = coinPriceOf(episode.RentalPrice, offer.unitAmount)
	}
	episode.CoinName = offer.name
}

// readingPeriodExpiry is when a purchase made at now with a reading period of
// hours stops opening its episode. No reading period is no expiry.
func readingPeriodExpiry(hours int32, now time.Time) sql.NullTime {
	if hours <= 0 {
		return sql.NullTime{}
	}
	return sql.NullTime{Time: now.AddDate(0, 0, int(hours/24)).Add(time.Duration(hours%24) * time.Hour), Valid: true}
}

// coinBalance reads the coins the reader can spend now on q, and what they
// owe.
func (s *apiServer) coinBalance(ctx context.Context, q Querier, tenantID, userID uuid.UUID, coinName string) (*publirav1.CoinBalance, error) {
	rows, err := q.ListUnspentCoinsForUser(ctx, dbmodels.ListUnspentCoinsForUserParams{
		TenantID: tenantID,
		UserID:   userID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to read the reader's coins", err, "tenant_id", tenantID.String(), "user_id", userID.String())
	}
	balance := &publirav1.CoinBalance{CoinName: coinName}
	for i, row := range rows {
		balance.Coins += row.Coins
		if i == 0 {
			balance.NearestExpiryAt = row.ExpiresAt.UTC().Format(time.RFC3339)
			balance.NearestExpiryCoins = row.Coins
		}
	}
	balance.ShortfallCoins, err = q.GetCoinShortfallOfUser(ctx, dbmodels.GetCoinShortfallOfUserParams{
		TenantID: tenantID,
		UserID:   userID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to read what the reader owes in coins", err, "tenant_id", tenantID.String(), "user_id", userID.String())
	}
	return balance, nil
}

func (s *apiServer) GetCoinSettings(
	ctx context.Context,
	req *publirav1.GetCoinSettingsRequest,
) (*publirav1.GetCoinSettingsResponse, error) {
	tenant, err := s.tenantByContext(ctx, req.Tenant)
	if err != nil {
		return nil, err
	}
	readerLocale, err := readerLocaleOf(req.Locale, tenant)
	if err != nil {
		return nil, err
	}
	offer, err := s.requireCoinOffer(ctx, tenant.ID, readerLocale)
	if err != nil {
		return nil, err
	}
	queries := s.queriesFor(ctx)
	currency, err := s.tenantCurrency(ctx, queries, tenant.ID)
	if err != nil {
		return nil, err
	}
	settings := &publirav1.CoinSettings{
		CoinName:       offer.name,
		CoinUnitAmount: offer.unitAmount,
		Currency:       currency,
		ExpiryDays:     offer.settings.ExpiryDays.Int32,
		Selling:        offer.settings.Selling,
		Packs:          make([]*publirav1.CoinPack, 0),
		Disclosures: &publirav1.CoinDisclosures{
			IssuerName: offer.settings.IssuerName,
			TermsUrl:   offer.settings.TermsUrl,
			Contact:    offer.settings.Contact,
			Notice:     offer.settings.Notice,
		},
	}
	if offer.settings.Selling {
		packs, err := queries.ListCoinPacksOnSale(ctx, tenant.ID)
		if err != nil {
			return nil, s.internalDBError(ctx, "failed to list the coin packs on sale", err, "tenant_id", tenant.ID.String())
		}
		for _, pack := range packs {
			settings.Packs = append(settings.Packs, &publirav1.CoinPack{
				Id:         pack.ID.String(),
				PublicId:   pack.PublicID,
				Coins:      pack.Coins,
				BonusCoins: pack.BonusCoins,
				Price:      pack.Price,
				Currency:   currency,
			})
		}
	}
	return &publirav1.GetCoinSettingsResponse{Settings: settings}, nil
}

func (s *apiServer) GetCoinBalance(
	ctx context.Context,
	req *publirav1.GetCoinBalanceRequest,
) (*publirav1.GetCoinBalanceResponse, error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}
	readerLocale, err := readerLocaleOf(req.Locale, tenant)
	if err != nil {
		return nil, err
	}
	offer, err := s.requireCoinOffer(ctx, tenant.ID, readerLocale)
	if err != nil {
		return nil, err
	}
	balance, err := s.coinBalance(ctx, s.queriesFor(ctx), tenant.ID, user.ID, offer.name)
	if err != nil {
		return nil, err
	}
	return noStorePrivateResponse(ctx, &publirav1.GetCoinBalanceResponse{Balance: balance}), nil
}

// coinTransactionPageRow is one entry of a coin history page, whichever way
// the page was scanned.
type coinTransactionPageRow struct {
	id                uuid.UUID
	kind              string
	coins             int32
	createdAt         time.Time
	grantExpiresAt    sql.NullTime
	purchaseID        uuid.NullUUID
	episodeID         uuid.NullUUID
	episodePublicID   string
	episodeOrderIndex int32
	episodeTitle      string
	episodeLocale     string
	seriesID          uuid.NullUUID
	seriesPublicID    string
	seriesTitle       string
	seriesLocale      string
	episodeShown      bool
}

func (s *apiServer) coinTransactionPage(
	ctx context.Context,
	tenantID, userID uuid.UUID,
	surface, locale string,
	keys pagination.TimeUUIDKeys,
	direction pagination.Direction,
	limit int32,
) ([]coinTransactionPageRow, error) {
	params := dbmodels.ListCoinTransactionsDescParams{
		TenantID:        tenantID,
		UserID:          userID,
		Surface:         surface,
		Locale:          locale,
		CursorCreatedAt: sql.NullTime{Time: keys.Time, Valid: keys.Valid},
		CursorInclusive: keys.Inclusive,
		CursorID:        uuid.NullUUID{UUID: keys.ID, Valid: keys.Valid},
		Limit:           limit,
	}
	var rows []dbmodels.ListCoinTransactionsDescRow
	if direction == pagination.Backward {
		ascRows, err := s.queriesFor(ctx).ListCoinTransactionsAsc(ctx, dbmodels.ListCoinTransactionsAscParams(params))
		if err != nil {
			return nil, err
		}
		for _, row := range ascRows {
			rows = append(rows, dbmodels.ListCoinTransactionsDescRow(row))
		}
	} else {
		descRows, err := s.queriesFor(ctx).ListCoinTransactionsDesc(ctx, params)
		if err != nil {
			return nil, err
		}
		rows = descRows
	}
	mapped := make([]coinTransactionPageRow, 0, len(rows))
	for _, row := range rows {
		mapped = append(mapped, coinTransactionPageRow{
			id:                row.ID,
			kind:              row.Kind,
			coins:             row.Coins,
			createdAt:         row.CreatedAt,
			grantExpiresAt:    row.GrantExpiresAt,
			purchaseID:        row.PurchaseID,
			episodeID:         row.EpisodeID,
			episodePublicID:   row.EpisodePublicID.String,
			episodeOrderIndex: row.EpisodeOrderIndex.Int32,
			episodeTitle:      row.EpisodeTitle,
			episodeLocale:     row.EpisodeTitleLocale,
			seriesID:          row.SeriesID,
			seriesPublicID:    row.SeriesPublicID.String,
			seriesTitle:       row.SeriesTitle,
			seriesLocale:      row.SeriesTitleLocale,
			episodeShown:      row.EpisodeShown,
		})
	}
	return mapped, nil
}

var errUnknownCoinTransactionKind = errors.New("unknown coin transaction kind")

func coinTransactionKindToProto(kind string) (publirav1.CoinTransactionKind, error) {
	switch kind {
	case "grant":
		return publirav1.CoinTransactionKind_COIN_TRANSACTION_KIND_GRANT, nil
	case "spend":
		return publirav1.CoinTransactionKind_COIN_TRANSACTION_KIND_SPEND, nil
	case "revocation":
		return publirav1.CoinTransactionKind_COIN_TRANSACTION_KIND_REVOCATION, nil
	case "expiry":
		return publirav1.CoinTransactionKind_COIN_TRANSACTION_KIND_EXPIRY, nil
	case "shortfall":
		return publirav1.CoinTransactionKind_COIN_TRANSACTION_KIND_SHORTFALL, nil
	case "shortfall_settlement":
		return publirav1.CoinTransactionKind_COIN_TRANSACTION_KIND_SHORTFALL_SETTLEMENT, nil
	default:
		return publirav1.CoinTransactionKind_COIN_TRANSACTION_KIND_UNSPECIFIED, errUnknownCoinTransactionKind
	}
}

func coinTransactionFromRow(row coinTransactionPageRow) (*publirav1.CoinTransaction, error) {
	kind, err := coinTransactionKindToProto(row.kind)
	if err != nil {
		return nil, err
	}
	item := &publirav1.CoinTransaction{
		Id:        row.id.String(),
		Kind:      kind,
		Coins:     row.coins,
		CreatedAt: row.createdAt.UTC().Format(time.RFC3339),
	}
	if kind == publirav1.CoinTransactionKind_COIN_TRANSACTION_KIND_GRANT && row.grantExpiresAt.Valid {
		item.ExpiresAt = row.grantExpiresAt.Time.UTC().Format(time.RFC3339)
	}
	if row.purchaseID.Valid {
		item.PurchaseId = row.purchaseID.UUID.String()
	}
	// A spend stays in the history whatever surface reads it, so the entries
	// still add up to the balance; one the surface may not show is not named.
	if row.episodeID.Valid && row.episodeShown {
		item.Episode = &publirattypesv1.Episode{
			Id:         row.episodeID.UUID.String(),
			PublicId:   row.episodePublicID,
			Title:      row.episodeTitle,
			Locale:     row.episodeLocale,
			OrderIndex: row.episodeOrderIndex,
		}
		item.Series = &publirattypesv1.Series{
			Id:       row.seriesID.UUID.String(),
			PublicId: row.seriesPublicID,
			Title:    row.seriesTitle,
			Locale:   row.seriesLocale,
		}
	}
	return item, nil
}

func (s *apiServer) ListCoinTransactions(
	ctx context.Context,
	req *publirav1.ListCoinTransactionsRequest,
) (*publirav1.ListCoinTransactionsResponse, error) {
	tenant, user, _, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}
	surface, err := callingSurface(req.Surface)
	if err != nil {
		return nil, err
	}
	readerLocale, err := readerLocaleOf(req.Locale, tenant)
	if err != nil {
		return nil, err
	}
	offer, err := s.requireCoinOffer(ctx, tenant.ID, readerLocale)
	if err != nil {
		return nil, err
	}

	limit := pagination.NormalizeLimit(req.Limit, defaultCoinTransactionPageSize, maxCoinTransactionPageSize)
	cursor, err := decodeSurfaceToken(req.Token, surface)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, "token is invalid")
	}
	var keys pagination.TimeUUIDKeys
	if !cursor.IsZero() {
		keys, err = pagination.DecodeTimeUUID(cursor)
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, "token is invalid")
		}
	}

	rows, err := s.coinTransactionPage(ctx, tenant.ID, user.ID, surface, readerLocale, keys, cursor.Direction, limit+1)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to list coin transactions", err, "tenant_id", tenant.ID.String(), "user_id", user.ID.String())
	}
	rows, hasMore := pagination.Page(rows, limit, cursor.Direction)
	items := make([]*publirav1.CoinTransaction, 0, len(rows))
	for _, row := range rows {
		item, err := coinTransactionFromRow(row)
		if err != nil {
			return nil, s.internalError(ctx, "coin transaction holds a kind this build does not know", err, "tenant_id", tenant.ID.String(), "coin_transaction_id", row.id.String())
		}
		items = append(items, item)
	}

	res := &publirav1.ListCoinTransactionsResponse{Transactions: items, CoinName: offer.name}
	switch {
	case len(rows) > 0:
		hasPrevious, hasNext := pagination.Neighbors(cursor, hasMore)
		if hasPrevious {
			res.PreviousToken = pagination.EncodeTimeUUID(pagination.Backward, rows[0].createdAt, rows[0].id)
		}
		if hasNext {
			last := rows[len(rows)-1]
			res.NextToken = pagination.EncodeTimeUUID(pagination.Forward, last.createdAt, last.id)
		}
	case cursor.Direction == pagination.Forward && !keys.Inclusive:
		res.PreviousToken = pagination.EncodeTimeUUIDRecovery(pagination.Backward, keys.Time, keys.ID)
	case cursor.Direction == pagination.Backward && !keys.Inclusive:
		res.NextToken = pagination.EncodeTimeUUIDRecovery(pagination.Forward, keys.Time, keys.ID)
	}
	bindSurfaceTokens(surface, &res.PreviousToken, &res.NextToken)
	return noStorePrivateResponse(ctx, res), nil
}

// coinPayment is a payment PayEpisodeWithCoins has been asked to make, read
// and checked from the request.
type coinPayment struct {
	tenantID       uuid.UUID
	userID         uuid.UUID
	episodeID      uuid.UUID
	kind           paymentprovider.Kind
	coins          int32
	idempotencyKey string
	locale         string
	coinName       string
}

func (s *apiServer) PayEpisodeWithCoins(
	ctx context.Context,
	req *publirav1.PayEpisodeWithCoinsRequest,
) (*publirav1.PayEpisodeWithCoinsResponse, error) {
	episodeID, err := requestRecordID("episode_id", req.EpisodeId)
	if err != nil {
		return nil, err
	}
	surface, err := callingSurface(req.Surface)
	if err != nil {
		return nil, err
	}
	kind, err := protomapper.PurchaseKindFromRequest(req.Kind)
	if err != nil {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, err, "kind")
	}
	if req.Coins <= 0 {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("coins must be the coin price the reader was shown"), "coins")
	}
	if n := utf8.RuneCountInString(req.IdempotencyKey); n == 0 || n > maxCoinIdempotencyKeyRunes {
		return nil, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errors.New("idempotency_key must be 1 to 200 characters"), "idempotency_key")
	}

	tenant, user, _, err := s.currentUserFromSession(ctx, req.Tenant, rpcmiddleware.RequestHeader(ctx))
	if err != nil {
		return nil, err
	}
	// Charged before anything is read: a payment is bounded by the coins the
	// reader holds, but a refused request is not.
	if err := s.chargeReaderAction(ctx, actionPayWithCoins, tenant.ID, user.ID); err != nil {
		return nil, err
	}
	readerLocale, err := readerLocaleOf(req.Locale, tenant)
	if err != nil {
		return nil, err
	}
	offer, err := s.requireCoinOffer(ctx, tenant.ID, readerLocale)
	if err != nil {
		return nil, err
	}
	payment := coinPayment{
		tenantID:       tenant.ID,
		userID:         user.ID,
		episodeID:      episodeID,
		kind:           kind,
		coins:          req.Coins,
		idempotencyKey: req.IdempotencyKey,
		locale:         readerLocale,
		coinName:       offer.name,
	}
	// A request sent again after its payment was made is answered with that
	// payment before anything about the episode is asked again: whatever has
	// changed since, the reader has already paid.
	if res, done, err := s.answerPaidCoinSpend(ctx, s.queriesFor(ctx), payment); done || err != nil {
		return res, err
	}

	episode, err := s.queriesFor(ctx).GetPurchasableEpisodeForTenant(ctx, dbmodels.GetPurchasableEpisodeForTenantParams{
		TenantID: tenant.ID,
		ID:       episodeID,
		Surface:  surface,
		Locale:   readerLocale,
	})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, connect.NewError(connect.CodeNotFound, "episode not found")
		}
		return nil, s.internalDBError(ctx, "failed to get purchasable episode", err, "tenant_id", tenant.ID.String(), "episode_id", episodeID.String())
	}
	if episode.Price <= 0 {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "free episodes are not paid for")
	}
	price, readingPeriodHours := episode.Price, episode.ReadingPeriodHours.Int32
	if kind == paymentprovider.KindPurchase && episode.CampaignPrice.Valid {
		price = episode.CampaignPrice.Int32
	}
	if kind == paymentprovider.KindRental {
		if !episode.RentalPrice.Valid || !episode.RentalPeriodHours.Valid {
			return nil, connect.NewError(connect.CodeFailedPrecondition, "episode is not rented")
		}
		price, readingPeriodHours = episode.RentalPrice.Int32, episode.RentalPeriodHours.Int32
	}
	soldHere, err := protomapper.PurchasableOn(episode.PurchaseAvailability, surface)
	if err != nil {
		return nil, s.internalError(ctx, "episode holds a purchase availability this build does not know", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}
	if !soldHere {
		return nil, connect.NewError(connect.CodeFailedPrecondition, "episode is not sold on this surface")
	}
	if err := s.refuseCreditedReader(ctx, tenant.ID, user.ID, episode.ID); err != nil {
		return nil, err
	}

	tx, err := s.beginTenantTx(ctx)
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to begin coin payment transaction", err, "tenant_id", tenant.ID.String())
	}
	defer tx.Rollback() //nolint:errcheck
	q := dbmodels.New(tx)

	// From here on the reader's other spends wait for this one, so the same
	// request sent twice finds the payment the first one made, and two
	// payments of the same episode find each other's purchase.
	if err := q.LockCoinSpendsOfUser(ctx, dbmodels.LockCoinSpendsOfUserParams{TenantID: tenant.ID, UserID: user.ID}); err != nil {
		return nil, s.internalDBError(ctx, "failed to lock the reader's coin spends", err, "tenant_id", tenant.ID.String())
	}
	if res, done, err := s.answerPaidCoinSpend(ctx, q, payment); done || err != nil {
		return res, err
	}
	// The settings are held until the payment commits, so it never lands after
	// a save that turned coins off or changed what one is worth.
	settings, err := q.LockTenantCoinConfigForSpend(ctx, tenant.ID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, coinsUnavailableError()
	}
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to lock the tenant's coin settings", err, "tenant_id", tenant.ID.String())
	}
	if !settings.Enabled || !settings.CoinUnitAmount.Valid {
		return nil, coinsUnavailableError()
	}
	coinPrice := coinPriceOf(price, settings.CoinUnitAmount.Int32)
	if coinPrice != req.Coins {
		return nil, rpcerrors.NewErrorInfoErrorWithMetadata(connect.CodeFailedPrecondition, errCoinPriceChanged, rpcerrors.ReasonCoinPriceChanged,
			map[string]string{rpcerrors.MetadataCoinPrice: strconv.Itoa(int(coinPrice))})
	}

	held, err := q.GetActiveEpisodePurchaseKinds(ctx, dbmodels.GetActiveEpisodePurchaseKindsParams{
		TenantID:  tenant.ID,
		UserID:    user.ID,
		EpisodeID: episode.ID,
	})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to check purchase status", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}
	if held.HoldsPurchase {
		return nil, connect.NewError(connect.CodeAlreadyExists, "episode is already purchased")
	}
	if kind == paymentprovider.KindRental && held.HoldsRental {
		return nil, connect.NewError(connect.CodeAlreadyExists, "episode is already rented")
	}

	currency, err := s.tenantCurrency(ctx, q, tenant.ID)
	if err != nil {
		return nil, err
	}
	grants, err := q.LockUnspentCoinGrantsForUser(ctx, dbmodels.LockUnspentCoinGrantsForUserParams{TenantID: tenant.ID, UserID: user.ID, Currency: currency})
	if err != nil {
		return nil, s.internalDBError(ctx, "failed to lock the reader's coins", err, "tenant_id", tenant.ID.String())
	}
	var available int64
	for _, grant := range grants {
		available += int64(grant.RemainingCoins)
	}
	if available < int64(coinPrice) {
		return nil, rpcerrors.NewErrorInfoErrorWithMetadata(connect.CodeFailedPrecondition, errCoinBalanceTooLow, rpcerrors.ReasonCoinBalanceInsufficient,
			map[string]string{rpcerrors.MetadataShortfall: strconv.FormatInt(int64(coinPrice)-available, 10)})
	}
	draws, salePrice := drawCoins(grants, coinPrice)
	if salePrice > math.MaxInt32 {
		return nil, s.internalError(ctx, "the coins spent are worth more than a price can hold", errCoinSpendTooValuable, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}

	spendID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}
	purchaseID, err := uuid.NewV7()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err.Error()).WithCause(err)
	}
	if _, err := q.CreatePurchasePaidWithCoins(ctx, dbmodels.CreatePurchasePaidWithCoinsParams{
		ID:        purchaseID,
		TenantID:  tenant.ID,
		UserID:    user.ID,
		EpisodeID: episode.ID,
		ExpiresAt: readingPeriodExpiry(readingPeriodHours, time.Now().UTC()),
		Price:     int32(salePrice),
		SpendID:   spendID,
		Currency:  currency,
		Kind:      string(kind),
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to record the purchase paid with coins", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}
	if err := q.CreateCoinSpend(ctx, dbmodels.CreateCoinSpendParams{
		ID:             spendID,
		TenantID:       tenant.ID,
		UserID:         user.ID,
		Coins:          coinPrice,
		PurchaseID:     purchaseID,
		IdempotencyKey: req.IdempotencyKey,
	}); err != nil {
		return nil, s.internalDBError(ctx, "failed to record the coin spend", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}
	for _, draw := range draws {
		if err := q.DrawCoinGrant(ctx, dbmodels.DrawCoinGrantParams{TenantID: tenant.ID, ID: draw.grantID, Coins: draw.coins}); err != nil {
			return nil, s.internalDBError(ctx, "failed to spend from a coin grant", err, "tenant_id", tenant.ID.String(), "coin_grant_id", draw.grantID.String())
		}
		if err := q.CreateCoinSpendAllocation(ctx, dbmodels.CreateCoinSpendAllocationParams{
			TenantID:      tenant.ID,
			TransactionID: spendID,
			GrantID:       draw.grantID,
			Coins:         draw.coins,
			Amount:        draw.amount,
		}); err != nil {
			return nil, s.internalDBError(ctx, "failed to record what a coin spend drew on", err, "tenant_id", tenant.ID.String(), "coin_grant_id", draw.grantID.String())
		}
	}
	// A purchase paid with coins is a purchase of the episode like any other
	// for the engagement it records. It took no payment, so no receipt is
	// owed for it: the receipt is the one for the pack the coins came from.
	if _, err := q.ProjectPurchaseContentEventByID(ctx, dbmodels.ProjectPurchaseContentEventByIDParams{
		ID:         uuid.Must(uuid.NewV7()),
		TenantID:   tenant.ID,
		PurchaseID: purchaseID,
	}); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, s.internalDBError(ctx, "failed to project the purchase content event", err, "tenant_id", tenant.ID.String(), "purchase_id", purchaseID.String())
	}
	if err := tx.Commit(); err != nil {
		return nil, s.internalDBError(ctx, "failed to commit the coin payment", err, "tenant_id", tenant.ID.String(), "episode_id", episode.ID.String())
	}
	return s.coinPaymentResponse(ctx, payment, purchaseID)
}

// coinDraw is the coins a spend takes from one grant, and what they are worth.
type coinDraw struct {
	grantID uuid.UUID
	coins   int32
	amount  int32
}

// drawCoins takes coins from the grants in the order they were locked, the one
// that expires first first, and answers what each draw takes and the sale
// price the coins add up to. grants hold at least coins between them.
func drawCoins(grants []dbmodels.LockUnspentCoinGrantsForUserRow, coins int32) ([]coinDraw, int64) {
	var draws []coinDraw
	var price int64
	left := coins
	for _, grant := range grants {
		if left == 0 {
			break
		}
		draw := coinDraw{grantID: grant.ID, coins: min(grant.RemainingCoins, left)}
		draw.amount = spentCoinsWorth(draw.coins, grant.Coins, grant.PaidAmount)
		draws = append(draws, draw)
		price += int64(draw.amount)
		left -= draw.coins
	}
	return draws, price
}

// spentCoinsWorth is what coins of a grant of granted coins, paid paid for,
// are worth: their part of the payment, every coin of the grant counting the
// same, the bonus coins of a pack among them, so the tenant bears a bonus as
// a discount. It is rounded down to the currency's minor unit. A partial
// refund of the pack leaves its coins with the reader and their worth as it
// was.
func spentCoinsWorth(coins, granted, paid int32) int32 {
	return int32(int64(coins) * int64(paid) / int64(granted))
}

// answerPaidCoinSpend answers a payment the reader's client already made with
// the same idempotency key, read on q. done is false when no payment carries
// the key.
func (s *apiServer) answerPaidCoinSpend(ctx context.Context, q Querier, payment coinPayment) (*publirav1.PayEpisodeWithCoinsResponse, bool, error) {
	paid, err := q.GetCoinSpendByIdempotencyKey(ctx, dbmodels.GetCoinSpendByIdempotencyKeyParams{
		TenantID:       payment.tenantID,
		UserID:         payment.userID,
		IdempotencyKey: payment.idempotencyKey,
	})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, true, s.internalDBError(ctx, "failed to read the coin spend of an idempotency key", err, "tenant_id", payment.tenantID.String())
	}
	if paid.EpisodeID != payment.episodeID || paid.Kind != string(payment.kind) {
		return nil, true, rpcerrors.NewFieldViolationError(connect.CodeInvalidArgument, errCoinIdempotencyKeyUsed, "idempotency_key")
	}
	res, err := s.coinPaymentResponse(ctx, payment, paid.PurchaseID)
	return res, true, err
}

// coinPaymentResponse answers a payment with the purchase it made and the
// reader's balance after it, read once it has committed.
func (s *apiServer) coinPaymentResponse(ctx context.Context, payment coinPayment, purchaseID uuid.UUID) (*publirav1.PayEpisodeWithCoinsResponse, error) {
	queries := s.queriesFor(ctx)
	purchase, err := s.myPurchase(ctx, queries, payment.tenantID, payment.userID, payment.locale, payment.coinName, purchaseID)
	if err != nil {
		return nil, err
	}
	balance, err := s.coinBalance(ctx, queries, payment.tenantID, payment.userID, payment.coinName)
	if err != nil {
		return nil, err
	}
	return noStorePrivateResponse(ctx, &publirav1.PayEpisodeWithCoinsResponse{Purchase: purchase, Balance: balance}), nil
}
