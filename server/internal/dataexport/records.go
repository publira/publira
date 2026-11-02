package dataexport

// The shapes the JSON files are written in. A field the install has no value
// for is null rather than left out, so every record of one file has the same
// keys. IDs are the public IDs the storefront's URLs carry; a purchase is
// named by the ID its receipt and the purchase history CSV name it by.

type accountRecord struct {
	PublicID        string  `json:"id"`
	Email           string  `json:"email"`
	Name            string  `json:"name"`
	Status          string  `json:"status"`
	CreatedAt       string  `json:"created_at"`
	EmailVerifiedAt *string `json:"email_verified_at"`
	BirthDate       *string `json:"birth_date"`
	// Locale is the language the reader last read in, which their
	// notifications are written in.
	Locale *string `json:"locale"`
}

type signInMethodsRecord struct {
	// Password is whether the account has one. The password itself is never
	// stored, and its hash is the means to sign in as the reader rather than
	// something about them.
	Password bool `json:"password"`
	// TwoFactorEnabled is when the second factor was turned on, null while it
	// is off.
	TwoFactorEnabled *string               `json:"two_factor_enabled_at"`
	LinkedAccounts   []linkedAccountRecord `json:"linked_accounts"`
	Passkeys         []passkeyRecord       `json:"passkeys"`
}

type linkedAccountRecord struct {
	Provider string `json:"provider"`
	// Email is the address the provider gave when the account was linked.
	Email    string `json:"email"`
	LinkedAt string `json:"linked_at"`
}

type passkeyRecord struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	RelyingParty string  `json:"relying_party"`
	CreatedAt    string  `json:"created_at"`
	LastUsedAt   *string `json:"last_used_at"`
}

type followRecord struct {
	// Kind is series, episode, or creator.
	Kind       string `json:"kind"`
	ID         string `json:"id"`
	Name       string `json:"name"`
	FollowedAt string `json:"followed_at"`
}

// episodeRef names the episode a record is about, and its series.
type episodeRef struct {
	SeriesID      string `json:"series_id"`
	SeriesTitle   string `json:"series_title"`
	EpisodeID     string `json:"episode_id"`
	EpisodeTitle  string `json:"episode_title"`
	EpisodeNumber int32  `json:"episode_number"`
}

type readingPositionRecord struct {
	episodeRef
	PageIndex int32  `json:"page_index"`
	PageCount int32  `json:"page_count"`
	UpdatedAt string `json:"updated_at"`
}

type episodeReadRecord struct {
	episodeRef
	ReadAt string `json:"read_at"`
}

type ratingRecord struct {
	episodeRef
	Score   int16  `json:"score"`
	RatedAt string `json:"rated_at"`
}

type commentRecord struct {
	ID string `json:"id"`
	episodeRef
	Body string `json:"body"`
	// Status is pending, published, hidden, or withdrawn.
	Status       string  `json:"status"`
	HiddenReason *string `json:"hidden_reason"`
	PostedAt     string  `json:"posted_at"`
	PublishedAt  *string `json:"published_at"`
	HiddenAt     *string `json:"hidden_at"`
	WithdrawnAt  *string `json:"withdrawn_at"`
}

type commentReportRecord struct {
	CommentID  string  `json:"comment_id"`
	Reason     string  `json:"reason"`
	Note       *string `json:"note"`
	Status     string  `json:"status"`
	ReportedAt string  `json:"reported_at"`
	ResolvedAt *string `json:"resolved_at"`
}

type purchaseRecord struct {
	ID string `json:"id"`
	// Kind is purchase or rental.
	Kind string `json:"kind"`
	// Item is episode, volume, remaining_episodes, or coin_pack, as the
	// purchase history CSV names it.
	Item string `json:"item"`
	// Status is active, expired, refunded, or canceled.
	Status      string `json:"status"`
	PurchasedAt string `json:"purchased_at"`
	Currency    string `json:"currency"`
	// Price and RefundedAmount are written in the currency, with no symbol:
	// 500 in JPY, 5.00 in USD.
	Price          string  `json:"price"`
	RefundedAmount string  `json:"refunded_amount"`
	ExpiresAt      *string `json:"expires_at"`
	RefundedAt     *string `json:"refunded_at"`
	RevokedAt      *string `json:"revoked_at"`
	// PaidThrough is the payment provider or the store the reader paid
	// through, null for a purchase paid with coins.
	PaidThrough   *string `json:"paid_through"`
	SeriesID      *string `json:"series_id"`
	SeriesTitle   *string `json:"series_title"`
	EpisodeID     *string `json:"episode_id"`
	EpisodeTitle  *string `json:"episode_title"`
	EpisodeNumber *int32  `json:"episode_number"`
	VolumeID      *string `json:"volume_id"`
	VolumeTitle   *string `json:"volume_title"`
	CoinPackID    *string `json:"coin_pack_id"`
	// Coins is what a pack granted, its bonus coins included.
	Coins      *int32 `json:"coins"`
	BonusCoins *int32 `json:"bonus_coins"`
	// CoinsSpent is what a purchase paid with coins spent.
	CoinsSpent *int32 `json:"coins_spent"`
}

type coinTransactionRecord struct {
	Kind string `json:"kind"`
	// Coins is positive for coins granted and negative for coins spent or
	// taken back.
	Coins      int32   `json:"coins"`
	PurchaseID *string `json:"purchase_id"`
	CreatedAt  string  `json:"created_at"`
}

type subscriptionRecord struct {
	PlanID   string `json:"plan_id"`
	PlanName string `json:"plan_name"`
	// Provider is the payment provider or the store the subscription is
	// billed through.
	Provider          string  `json:"provider"`
	Status            string  `json:"status"`
	CurrentPeriodEnd  *string `json:"current_period_end"`
	CancelAtPeriodEnd bool    `json:"cancel_at_period_end"`
	StartedAt         string  `json:"started_at"`
	UpdatedAt         string  `json:"updated_at"`
}

// preferencesRecord holds the settings the reader saved. One they never saved
// is null: the install keeps nothing about it, and shows them its defaults.
type preferencesRecord struct {
	NotificationSettings *notificationSettingsRecord `json:"notification_settings"`
	ViewerPreferences    *viewerPreferencesRecord    `json:"viewer_preferences"`
}

type notificationSettingsRecord struct {
	FollowedEpisodes channelsRecord `json:"followed_episodes"`
	FollowedCreators channelsRecord `json:"followed_creators"`
	Comments         channelsRecord `json:"comments"`
	Announcements    channelsRecord `json:"announcements"`
	UpdatedAt        string         `json:"updated_at"`
}

// channelsRecord is which channels one kind of notification reaches the
// reader through. A kind that is never pushed has its push channels off.
type channelsRecord struct {
	Inbox      bool `json:"inbox"`
	Email      bool `json:"email"`
	WebPush    bool `json:"web_push"`
	MobilePush bool `json:"mobile_push"`
}

type viewerPreferencesRecord struct {
	WideViewer bool   `json:"wide_viewer"`
	UpdatedAt  string `json:"updated_at"`
}

type legalPageConsentRecord struct {
	// Page is the slug of the page agreed to: its URL on the site.
	Page     string `json:"page"`
	Title    string `json:"title"`
	Locale   string `json:"locale"`
	Version  int32  `json:"version"`
	AgreedAt string `json:"agreed_at"`
}

type accessTicketRecord struct {
	ID string `json:"id"`
	episodeRef
	Source    string  `json:"source"`
	GrantedAt string  `json:"granted_at"`
	ExpiresAt *string `json:"expires_at"`
	RevokedAt *string `json:"revoked_at"`
}

type contactMessageRecord struct {
	ID           string               `json:"id"`
	ReplyToEmail string               `json:"reply_to_email"`
	Subject      *string              `json:"subject"`
	Body         string               `json:"body"`
	SentAt       string               `json:"sent_at"`
	HandledAt    *string              `json:"handled_at"`
	Replies      []contactReplyRecord `json:"replies"`
}

type contactReplyRecord struct {
	// From is reader or staff.
	From string `json:"from"`
	// FromEmail is the address a reader wrote back from, null on staff's.
	FromEmail *string `json:"from_email"`
	Body      string  `json:"body"`
	SentAt    string  `json:"sent_at"`
}
