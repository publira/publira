package outbox

import (
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/emailrenderer"
	"github.com/publira/publira/server/internal/locale"
)

const (
	copyExpiresAt   = "2030-01-15T12:00:00Z"
	copyReceivedAt  = "2030-01-15T12:00:00Z"
	copyPurchasedAt = "2030-01-15T12:00:00Z"
)

// emailCopyCases is one request per template the worker sends, and one more for
// each template whose copy branches on a value the sender supplies.
var emailCopyCases = []struct {
	name     string
	subjects map[string]string
	request  emailrenderer.Request
}{
	{
		name:     "tenant_admin_invitation as a tenant_admin",
		subjects: map[string]string{"en": "Aoto Press admin invitation", "ja": "Aoto Press管理者招待"},
		request: emailrenderer.Request{
			Template: "tenant_admin_invitation",
			Data: map[string]any{
				"expires_at":  copyExpiresAt,
				"invite_url":  "https://admin.example.test/accept-invite?token=invite",
				"role":        "tenant_admin",
				"tenant_name": "Aoto Press",
			},
		},
	},
	{
		name:     "tenant_admin_invitation as a tenant_editor",
		subjects: map[string]string{"en": "Aoto Press editor invitation", "ja": "Aoto Press編集担当への招待"},
		request: emailrenderer.Request{
			Template: "tenant_admin_invitation",
			Data: map[string]any{
				"expires_at":  copyExpiresAt,
				"invite_url":  "https://admin.example.test/accept-invite?token=invite",
				"role":        "tenant_editor",
				"tenant_name": "Aoto Press",
			},
		},
	},
	{
		name:     "tenant_admin_invitation as a tenant_auditor",
		subjects: map[string]string{"en": "Aoto Press auditor invitation", "ja": "Aoto Press監査担当への招待"},
		request: emailrenderer.Request{
			Template: "tenant_admin_invitation",
			Data: map[string]any{
				"expires_at":  copyExpiresAt,
				"invite_url":  "https://admin.example.test/accept-invite?token=invite",
				"role":        "tenant_auditor",
				"tenant_name": "Aoto Press",
			},
		},
	},
	{
		name:     "reader_email_verification",
		subjects: map[string]string{"en": "Aoto Press email address verification", "ja": "Aoto Pressメールアドレス確認"},
		request: emailrenderer.Request{
			Template: "reader_email_verification",
			Data: map[string]any{
				"expires_at":  copyExpiresAt,
				"tenant_name": "Aoto Press",
				"verify_url":  "https://reader.example.test/verify?token=verify",
			},
		},
	},
	{
		name:     "reader_email_change_confirmation to the current address",
		subjects: map[string]string{"en": "Aoto Press email address change confirmation", "ja": "Aoto Pressメールアドレス変更確認"},
		request: emailrenderer.Request{
			Template: "reader_email_change_confirmation",
			Data: map[string]any{
				"confirm_url":    "https://reader.example.test/confirm-email?token=confirm",
				"current_email":  "old@example.com",
				"expires_at":     copyExpiresAt,
				"new_email":      "new@example.com",
				"recipient_kind": "current_email",
				"tenant_name":    "Aoto Press",
			},
		},
	},
	{
		name:     "reader_email_change_confirmation to the new address",
		subjects: map[string]string{"en": "Aoto Press email address change confirmation", "ja": "Aoto Pressメールアドレス変更確認"},
		request: emailrenderer.Request{
			Template: "reader_email_change_confirmation",
			Data: map[string]any{
				"confirm_url":    "https://reader.example.test/confirm-email?token=confirm",
				"current_email":  "old@example.com",
				"expires_at":     copyExpiresAt,
				"new_email":      "new@example.com",
				"recipient_kind": "new_email",
				"tenant_name":    "Aoto Press",
			},
		},
	},
	{
		name:     "reader_email_changed_notice",
		subjects: map[string]string{"en": "Aoto Press email address changed", "ja": "Aoto Pressメールアドレス変更完了"},
		request: emailrenderer.Request{
			Template: "reader_email_changed_notice",
			Data: map[string]any{
				"new_email":      "new@example.com",
				"previous_email": "old@example.com",
				"tenant_name":    "Aoto Press",
			},
		},
	},
	{
		name:     "reader_password_reset",
		subjects: map[string]string{"en": "Aoto Press password reset", "ja": "Aoto Pressパスワード再設定"},
		request: emailrenderer.Request{
			Template: "reader_password_reset",
			Data: map[string]any{
				"expires_at":  copyExpiresAt,
				"reset_url":   "https://reader.example.test/confirm-password?token=reset",
				"tenant_name": "Aoto Press",
			},
		},
	},
	{
		name:     "reader_password_changed_notice",
		subjects: map[string]string{"en": "Aoto Press password changed", "ja": "Aoto Pressパスワード変更完了"},
		request: emailrenderer.Request{
			Template: "reader_password_changed_notice",
			Data: map[string]any{
				"email":       "reader@example.com",
				"reset_url":   "https://reader.example.test/reset-password",
				"tenant_name": "Aoto Press",
			},
		},
	},
	{
		name:     "reader_signup_attempt_notice for a confirmed account",
		subjects: map[string]string{"en": "Aoto Press sign-up attempt", "ja": "Aoto Pressアカウント登録の試行"},
		request: emailrenderer.Request{
			Template: "reader_signup_attempt_notice",
			Data: map[string]any{
				"account_state": "confirmed",
				"action_url":    "https://reader.example.test/reset-password",
				"email":         "reader@example.com",
				"tenant_name":   "Aoto Press",
			},
		},
	},
	{
		name:     "reader_signup_attempt_notice for an unconfirmed account",
		subjects: map[string]string{"en": "Aoto Press sign-up attempt", "ja": "Aoto Pressアカウント登録の試行"},
		request: emailrenderer.Request{
			Template: "reader_signup_attempt_notice",
			Data: map[string]any{
				"account_state": "unconfirmed",
				"action_url":    "https://reader.example.test/resend-verification",
				"email":         "reader@example.com",
				"tenant_name":   "Aoto Press",
			},
		},
	},
	{
		name:     "admin_console_email_change_confirmation",
		subjects: map[string]string{"en": "Aoto Press admin console email address change confirmation", "ja": "Aoto Press管理画面メールアドレス変更確認"},
		request: emailrenderer.Request{
			Template: "admin_console_email_change_confirmation",
			Data: map[string]any{
				"confirm_url":    "https://admin.example.test/confirm-email?token=confirm",
				"current_email":  "old@example.com",
				"expires_at":     copyExpiresAt,
				"new_email":      "new@example.com",
				"recipient_kind": "current_email",
				"tenant_name":    "Aoto Press",
			},
		},
	},
	{
		name:     "admin_console_email_changed_notice",
		subjects: map[string]string{"en": "Aoto Press admin console email address changed", "ja": "Aoto Press管理画面メールアドレス変更完了"},
		request: emailrenderer.Request{
			Template: "admin_console_email_changed_notice",
			Data: map[string]any{
				"new_email":      "new@example.com",
				"previous_email": "old@example.com",
				"tenant_name":    "Aoto Press",
			},
		},
	},
	{
		name:     "admin_console_password_reset",
		subjects: map[string]string{"en": "Aoto Press admin console password reset", "ja": "Aoto Press管理画面パスワード再設定"},
		request: emailrenderer.Request{
			Template: "admin_console_password_reset",
			Data: map[string]any{
				"expires_at":  copyExpiresAt,
				"reset_url":   "https://admin.example.test/confirm-password?token=reset",
				"tenant_name": "Aoto Press",
			},
		},
	},
	{
		name:     "platform_console_email_change_confirmation",
		subjects: map[string]string{"en": "Publira Platform Console email address change confirmation", "ja": "Publiraプラットフォーム管理画面メールアドレス変更確認"},
		request: emailrenderer.Request{
			Template: "platform_console_email_change_confirmation",
			Data: map[string]any{
				"confirm_url":    "https://platform.example.test/confirm-email?token=confirm",
				"current_email":  "old@example.com",
				"expires_at":     copyExpiresAt,
				"new_email":      "new@example.com",
				"recipient_kind": "new_email",
			},
		},
	},
	{
		name:     "platform_console_email_changed_notice",
		subjects: map[string]string{"en": "Publira Platform Console email address changed", "ja": "Publiraプラットフォーム管理画面メールアドレス変更完了"},
		request: emailrenderer.Request{
			Template: "platform_console_email_changed_notice",
			Data: map[string]any{
				"new_email":      "new@example.com",
				"previous_email": "old@example.com",
			},
		},
	},
	{
		name:     "platform_console_operator_added",
		subjects: map[string]string{"en": "Your Publira Platform Console account", "ja": "Publiraプラットフォーム管理画面アカウントのご案内"},
		request: emailrenderer.Request{
			Template: "platform_console_operator_added",
			Data: map[string]any{
				"expires_at":       copyExpiresAt,
				"set_password_url": "https://platform.example.test/confirm-password?token=first",
			},
		},
	},
	{
		name:     "platform_console_operator_role_granted",
		subjects: map[string]string{"en": "Publira Platform Console access", "ja": "Publiraプラットフォーム管理画面ログインのご案内"},
		request: emailrenderer.Request{
			Template: "platform_console_operator_role_granted",
			Data: map[string]any{
				"sign_in_url": "https://platform.example.test/login",
			},
		},
	},
	{
		name:     "platform_console_password_reset",
		subjects: map[string]string{"en": "Publira Platform Console password reset", "ja": "Publiraプラットフォーム管理画面パスワード再設定"},
		request: emailrenderer.Request{
			Template: "platform_console_password_reset",
			Data: map[string]any{
				"expires_at": copyExpiresAt,
				"reset_url":  "https://platform.example.test/confirm-password?token=reset",
			},
		},
	},
	{
		name:     "staff_contact_message_notice from a signed-in reader",
		subjects: map[string]string{"en": "Aoto Press contact message", "ja": "Aoto Pressお問い合わせ"},
		request: emailrenderer.Request{
			Template: "staff_contact_message_notice",
			Data: map[string]any{
				"body":           "The date of birth on my account is wrong.",
				"received_at":    copyReceivedAt,
				"reply_to_email": "reader@example.com",
				"sender_name":    "Rin Amagai",
				"subject":        "Wrong date of birth",
				"tenant_name":    "Aoto Press",
			},
		},
	},
	{
		name:     "staff_contact_message_notice from a guest who titled nothing",
		subjects: map[string]string{"en": "Aoto Press contact message", "ja": "Aoto Pressお問い合わせ"},
		request: emailrenderer.Request{
			Template: "staff_contact_message_notice",
			Data: map[string]any{
				"body":           "Which episodes can I read without an account?",
				"received_at":    copyReceivedAt,
				"reply_to_email": "guest@example.com",
				"sender_name":    "",
				"subject":        "",
				"tenant_name":    "Aoto Press",
			},
		},
	},
	{
		name:     "purchase_receipt for a purchase with a reading period",
		subjects: map[string]string{"en": "Aoto Press purchase receipt", "ja": "Aoto Press購入完了"},
		request: emailrenderer.Request{
			Template: "purchase_receipt",
			Data: map[string]any{
				"amount":                      int64(500),
				"currency":                    "JPY",
				"episode_title":               "Episode 1",
				"expires_at":                  "2030-01-17T12:00:00Z",
				"is_test":                     false,
				"library_url":                 "https://reader.example.test/my/library",
				"purchased_at":                copyPurchasedAt,
				"series_title":                "The Lighthouse Keeper",
				"tenant_name":                 "Aoto Press",
				"volume_title":                "",
				"series_bundle_episode_count": int64(0),
				"coin_pack_coins":             int64(0),
				"coin_pack_bonus_coins":       int64(0),
				"coin_name":                   "",
				"coins_expire_at":             "",
			},
		},
	},
	{
		name:     "purchase_receipt for a purchase with no reading period",
		subjects: map[string]string{"en": "Aoto Press purchase receipt", "ja": "Aoto Press購入完了"},
		request: emailrenderer.Request{
			Template: "purchase_receipt",
			Data: map[string]any{
				"amount":                      int64(499),
				"currency":                    "USD",
				"episode_title":               "Episode 1",
				"expires_at":                  "",
				"is_test":                     false,
				"library_url":                 "https://reader.example.test/my/library",
				"purchased_at":                copyPurchasedAt,
				"series_title":                "The Lighthouse Keeper",
				"tenant_name":                 "Aoto Press",
				"volume_title":                "",
				"series_bundle_episode_count": int64(0),
				"coin_pack_coins":             int64(0),
				"coin_pack_bonus_coins":       int64(0),
				"coin_name":                   "",
				"coins_expire_at":             "",
			},
		},
	},
	{
		name:     "purchase_receipt for a purchase in the provider's test mode",
		subjects: map[string]string{"en": "Aoto Press purchase receipt", "ja": "Aoto Press購入完了"},
		request: emailrenderer.Request{
			Template: "purchase_receipt",
			Data: map[string]any{
				"amount":                      int64(100),
				"currency":                    "JPY",
				"episode_title":               "Episode 1",
				"expires_at":                  "",
				"is_test":                     true,
				"library_url":                 "https://reader.example.test/my/library",
				"purchased_at":                copyPurchasedAt,
				"series_title":                "The Lighthouse Keeper",
				"tenant_name":                 "Aoto Press",
				"volume_title":                "",
				"series_bundle_episode_count": int64(0),
				"coin_pack_coins":             int64(0),
				"coin_pack_bonus_coins":       int64(0),
				"coin_name":                   "",
				"coins_expire_at":             "",
			},
		},
	},
	{
		name:     "purchase_receipt for a purchase of a volume",
		subjects: map[string]string{"en": "Aoto Press purchase receipt", "ja": "Aoto Press購入完了"},
		request: emailrenderer.Request{
			Template: "purchase_receipt",
			Data: map[string]any{
				"amount":                      int64(1500),
				"currency":                    "JPY",
				"episode_title":               "",
				"expires_at":                  "",
				"is_test":                     false,
				"library_url":                 "https://reader.example.test/my/library",
				"purchased_at":                copyPurchasedAt,
				"series_title":                "The Lighthouse Keeper",
				"tenant_name":                 "Aoto Press",
				"volume_title":                "Volume 1",
				"series_bundle_episode_count": int64(0),
				"coin_pack_coins":             int64(0),
				"coin_pack_bonus_coins":       int64(0),
				"coin_name":                   "",
				"coins_expire_at":             "",
			},
		},
	},
	{
		name:     "purchase_receipt for a purchase of the rest of a series",
		subjects: map[string]string{"en": "Aoto Press purchase receipt", "ja": "Aoto Press購入完了"},
		request: emailrenderer.Request{
			Template: "purchase_receipt",
			Data: map[string]any{
				"amount":                      int64(2700),
				"currency":                    "JPY",
				"episode_title":               "",
				"expires_at":                  "",
				"is_test":                     false,
				"library_url":                 "https://reader.example.test/my/library",
				"purchased_at":                copyPurchasedAt,
				"series_title":                "The Lighthouse Keeper",
				"tenant_name":                 "Aoto Press",
				"volume_title":                "",
				"series_bundle_episode_count": int64(12),
				"coin_pack_coins":             int64(0),
				"coin_pack_bonus_coins":       int64(0),
				"coin_name":                   "",
				"coins_expire_at":             "",
			},
		},
	},
	{
		name:     "reader_episode_published",
		subjects: map[string]string{"en": "New episode of The Lighthouse Keeper", "ja": "The Lighthouse Keeperの新しいエピソード"},
		request: emailrenderer.Request{
			Template: "reader_episode_published",
			Data: map[string]any{
				"episode_title": "The First Night",
				"episode_url":   "https://reader.example.test/series/SERIES000001/episodes/EPISODE00001",
				"series_title":  "The Lighthouse Keeper",
				"settings_url":  "https://reader.example.test/settings/notifications",
				"tenant_name":   "Aoto Press",
			},
		},
	},
	{
		name:     "reader_announcement_posted to the readers who chose it",
		subjects: map[string]string{"en": "Aoto Press announcement: Scheduled maintenance", "ja": "Aoto Pressからのお知らせ「Scheduled maintenance」"},
		request: emailrenderer.Request{
			Template: "reader_announcement_posted",
			Data: map[string]any{
				"announcement_title": "Scheduled maintenance",
				"announcements_url":  "https://reader.example.test/announcements",
				"sent_to_everyone":   false,
				"settings_url":       "https://reader.example.test/settings/notifications",
				"tenant_name":        "Aoto Press",
			},
		},
	},
	{
		name:     "reader_announcement_posted to everyone",
		subjects: map[string]string{"en": "Aoto Press announcement: New terms of use", "ja": "Aoto Pressからのお知らせ「New terms of use」"},
		request: emailrenderer.Request{
			Template: "reader_announcement_posted",
			Data: map[string]any{
				"announcement_title": "New terms of use",
				"announcements_url":  "https://reader.example.test/announcements",
				"sent_to_everyone":   true,
				"tenant_name":        "Aoto Press",
			},
		},
	},
	{
		name:     "reader_comment_approved",
		subjects: map[string]string{"en": "Your comment on Aoto Press is now public", "ja": "Aoto Pressでのコメントが公開されました"},
		request: emailrenderer.Request{
			Template: "reader_comment_approved",
			Data: map[string]any{
				"episode_title": "The First Night",
				"episode_url":   "https://reader.example.test/series/SERIES000001/episodes/EPISODE00001",
				"series_title":  "The Lighthouse Keeper",
				"settings_url":  "https://reader.example.test/settings/notifications",
				"tenant_name":   "Aoto Press",
			},
		},
	},
	{
		name:     "staff_contact_reply to a titled message",
		subjects: map[string]string{"en": "Re: Wrong date of birth", "ja": "Re: Wrong date of birth"},
		request: emailrenderer.Request{
			Template: "staff_contact_reply",
			Data: map[string]any{
				"body":                 "We have corrected the date of birth on your account.",
				"original_body":        "The date of birth on my account is wrong.",
				"original_received_at": copyReceivedAt,
				"original_subject":     "Wrong date of birth",
				"tenant_name":          "Aoto Press",
			},
		},
	},
	{
		name:     "staff_contact_reply to an untitled message",
		subjects: map[string]string{"en": "Re: Your message to Aoto Press", "ja": "Re: Aoto Pressへのお問い合わせ"},
		request: emailrenderer.Request{
			Template: "staff_contact_reply",
			Data: map[string]any{
				"body":                 "Every episode marked free can be read without an account.",
				"original_body":        "Which episodes can I read without an account?",
				"original_received_at": copyReceivedAt,
				"original_subject":     "",
				"tenant_name":          "Aoto Press",
			},
		},
	},
}

func TestEmailCopyWritesTheWholeMail(t *testing.T) {
	for _, testCase := range []struct {
		locale      string
		wantSubject string
		wantText    string
	}{
		{
			locale:      "en",
			wantSubject: "Aoto Press password reset",
			wantText: "Aoto Press\n\nReset your password\n\n" +
				"We received a request to reset your password.\n\n" +
				"Open the button below to set a new password.\n\n" +
				"Reset password https://reader.example.test/confirm-password?token=reset\n\n" +
				"This link expires at Jan 15, 2030, 12:00 PM.\n\n" +
				"If you were not expecting this email, you can ignore it.\n\n" +
				"If the button does not work, paste this URL into your browser. https://reader.example.test/confirm-password?token=reset\n\n" +
				"This email was sent by Aoto Press.",
		},
		{
			locale:      "ja",
			wantSubject: "Aoto Pressパスワード再設定",
			wantText: "Aoto Press\n\nパスワードの再設定\n\n" +
				"パスワード再設定のリクエストを受け付けました。\n\n" +
				"以下のボタンから新しいパスワードを設定してください。\n\n" +
				"パスワードを再設定する https://reader.example.test/confirm-password?token=reset\n\n" +
				"このリンクの有効期限は2030/01/15 12:00です。\n\n" +
				"心当たりがない場合、このメールは破棄してください。\n\n" +
				"ボタンが使えない場合は、次のURLをブラウザに貼り付けてください。 https://reader.example.test/confirm-password?token=reset\n\n" +
				"このメールはAoto Pressから送信されています。",
		},
	} {
		t.Run(testCase.locale, func(t *testing.T) {
			email, err := emailCopy(emailrenderer.Request{
				Template: "reader_password_reset",
				Locale:   testCase.locale,
				Data: map[string]any{
					"expires_at":  copyExpiresAt,
					"reset_url":   "https://reader.example.test/confirm-password?token=reset",
					"tenant_name": "Aoto Press",
				},
				TimeZone: "UTC",
			})
			if err != nil {
				t.Fatalf("emailCopy: %v", err)
			}
			if email.Subject != testCase.wantSubject {
				t.Errorf("subject = %q, want %q", email.Subject, testCase.wantSubject)
			}
			if email.Text != testCase.wantText {
				t.Errorf("text =\n%q\nwant\n%q", email.Text, testCase.wantText)
			}
		})
	}
}

// An answer opens with what staff wrote and quotes the reader's message under
// it, line by line, the way a reply from a mail client does.
func TestEmailCopyQuotesTheMessageAStaffReplyAnswers(t *testing.T) {
	email, err := emailCopy(emailrenderer.Request{
		Template: "staff_contact_reply",
		Locale:   "en",
		Data: map[string]any{
			"body":                 "We have corrected it.\nSorry for the trouble.",
			"original_body":        "The date of birth on my account is wrong.\n\nCould you correct it?",
			"original_received_at": copyReceivedAt,
			"original_subject":     "Wrong date of birth",
			"tenant_name":          "Aoto Press",
		},
		TimeZone: "UTC",
	})
	if err != nil {
		t.Fatalf("emailCopy: %v", err)
	}
	want := "Aoto Press\n\nWe have corrected it.\nSorry for the trouble.\n\n" +
		"On Jan 15, 2030, 12:00 PM, you wrote:\n\n" +
		"> The date of birth on my account is wrong.\n>\n> Could you correct it?\n\n" +
		"To answer, reply to this email.\n\n" +
		"This email was sent by Aoto Press."
	if email.Text != want {
		t.Errorf("text =\n%q\nwant\n%q", email.Text, want)
	}
}

// A receipt states the purchase in the tenant's language and zone: the price
// as the locale writes the currency, with its code beside the symbol, the end
// of the reading period only for a purchase that has one, and that no money was
// taken for a purchase in the provider's test mode.
func TestEmailCopyWritesAPurchaseReceipt(t *testing.T) {
	for _, testCase := range []struct {
		name         string
		locale       string
		amount       int64
		currency     string
		expiresAt    string
		isTest       bool
		episodeTitle string
		volumeTitle  string
		bundleCount  int64
		// coins, bonusCoins, coinName, and coinsExpireAt describe a pack.
		coins         int64
		bonusCoins    int64
		coinName      string
		coinsExpireAt string
		wantText      string
	}{
		{
			name:         "in English with a reading period",
			locale:       "en",
			amount:       500,
			currency:     "JPY",
			expiresAt:    "2030-01-17T12:00:00Z",
			episodeTitle: "Episode 1",
			wantText: "Aoto Press\n\nThank you for your purchase\n\n" +
				"Here is the receipt for your purchase on Aoto Press.\n\n" +
				"Series: The Lighthouse Keeper\n\nEpisode: Episode 1\n\n" +
				"Price paid: ¥500 (JPY)\n\n" +
				"Purchased: Jan 15, 2030, 9:00 PM\n\n" +
				"Readable until: Jan 17, 2030, 9:00 PM\n\n" +
				"Open your purchases https://reader.example.test/my/library\n\n" +
				"If the button does not work, paste this URL into your browser. https://reader.example.test/my/library\n\n" +
				"This email was sent by Aoto Press.",
		},
		{
			name:         "in Japanese with no reading period",
			locale:       "ja",
			amount:       499,
			currency:     "USD",
			episodeTitle: "Episode 1",
			wantText: "Aoto Press\n\nご購入ありがとうございます\n\n" +
				"Aoto Pressでのご購入内容をお知らせします。\n\n" +
				"シリーズ「The Lighthouse Keeper」\n\nエピソード「Episode 1」\n\n" +
				"購入価格は$4.99(USD)です。\n\n" +
				"購入日時は2030/01/15 21:00です。\n\n" +
				"購入済み一覧を開く https://reader.example.test/my/library\n\n" +
				"ボタンが使えない場合は、次のURLをブラウザに貼り付けてください。 https://reader.example.test/my/library\n\n" +
				"このメールはAoto Pressから送信されています。",
		},
		{
			name:         "in English for a test-mode purchase",
			locale:       "en",
			amount:       100,
			currency:     "JPY",
			isTest:       true,
			episodeTitle: "Episode 1",
			wantText: "Aoto Press\n\nThank you for your purchase\n\n" +
				"Here is the receipt for your purchase on Aoto Press.\n\n" +
				"This was a purchase in the payment provider's test mode. No money was charged.\n\n" +
				"Series: The Lighthouse Keeper\n\nEpisode: Episode 1\n\n" +
				"Price paid: ¥100 (JPY)\n\n" +
				"Purchased: Jan 15, 2030, 9:00 PM\n\n" +
				"Open your purchases https://reader.example.test/my/library\n\n" +
				"If the button does not work, paste this URL into your browser. https://reader.example.test/my/library\n\n" +
				"This email was sent by Aoto Press.",
		},
		{
			name:        "in English for a volume",
			locale:      "en",
			amount:      1500,
			currency:    "JPY",
			volumeTitle: "Volume 1",
			wantText: "Aoto Press\n\nThank you for your purchase\n\n" +
				"Here is the receipt for your purchase on Aoto Press.\n\n" +
				"Series: The Lighthouse Keeper\n\nVolume: Volume 1\n\n" +
				"Price paid: ¥1,500 (JPY)\n\n" +
				"Purchased: Jan 15, 2030, 9:00 PM\n\n" +
				"Open your purchases https://reader.example.test/my/library\n\n" +
				"If the button does not work, paste this URL into your browser. https://reader.example.test/my/library\n\n" +
				"This email was sent by Aoto Press.",
		},
		{
			name:        "in English for the rest of a series",
			locale:      "en",
			amount:      2700,
			currency:    "JPY",
			bundleCount: 12,
			wantText: "Aoto Press\n\nThank you for your purchase\n\n" +
				"Here is the receipt for your purchase on Aoto Press.\n\n" +
				"Series: The Lighthouse Keeper\n\nRemaining episodes: 12 episodes\n\n" +
				"Price paid: ¥2,700 (JPY)\n\n" +
				"Purchased: Jan 15, 2030, 9:00 PM\n\n" +
				"Open your purchases https://reader.example.test/my/library\n\n" +
				"If the button does not work, paste this URL into your browser. https://reader.example.test/my/library\n\n" +
				"This email was sent by Aoto Press.",
		},
		{
			name:        "in Japanese for the rest of a series",
			locale:      "ja",
			amount:      2700,
			currency:    "JPY",
			bundleCount: 12,
			wantText: "Aoto Press\n\nご購入ありがとうございます\n\n" +
				"Aoto Pressでのご購入内容をお知らせします。\n\n" +
				"シリーズ「The Lighthouse Keeper」\n\n残りのエピソード12話\n\n" +
				"購入価格は￥2,700(JPY)です。\n\n" +
				"購入日時は2030/01/15 21:00です。\n\n" +
				"購入済み一覧を開く https://reader.example.test/my/library\n\n" +
				"ボタンが使えない場合は、次のURLをブラウザに貼り付けてください。 https://reader.example.test/my/library\n\n" +
				"このメールはAoto Pressから送信されています。",
		},
		{
			name:          "in English for a pack with bonus coins",
			locale:        "en",
			amount:        1000,
			currency:      "JPY",
			coins:         1000,
			bonusCoins:    100,
			coinName:      "Points",
			coinsExpireAt: "2030-07-14T12:00:00Z",
			wantText: "Aoto Press\n\nThank you for your purchase\n\n" +
				"Here is the receipt for your purchase on Aoto Press.\n\n" +
				"Points: 1,100 (including 100 bonus)\n\n" +
				"Price paid: ¥1,000 (JPY)\n\n" +
				"Purchased: Jan 15, 2030, 9:00 PM\n\n" +
				"Spendable until: Jul 14, 2030, 9:00 PM\n\n" +
				"Open your purchases https://reader.example.test/my/library\n\n" +
				"If the button does not work, paste this URL into your browser. https://reader.example.test/my/library\n\n" +
				"This email was sent by Aoto Press.",
		},
		{
			name:          "in Japanese for a pack",
			locale:        "ja",
			amount:        500,
			currency:      "JPY",
			coins:         500,
			coinName:      "ポイント",
			coinsExpireAt: "2030-07-14T12:00:00Z",
			wantText: "Aoto Press\n\nご購入ありがとうございます\n\n" +
				"Aoto Pressでのご購入内容をお知らせします。\n\n" +
				"500ポイント\n\n" +
				"購入価格は￥500(JPY)です。\n\n" +
				"購入日時は2030/01/15 21:00です。\n\n" +
				"利用期限は2030/07/14 21:00です。\n\n" +
				"購入済み一覧を開く https://reader.example.test/my/library\n\n" +
				"ボタンが使えない場合は、次のURLをブラウザに貼り付けてください。 https://reader.example.test/my/library\n\n" +
				"このメールはAoto Pressから送信されています。",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			email, err := emailCopy(emailrenderer.Request{
				Template: "purchase_receipt",
				Locale:   testCase.locale,
				Data: map[string]any{
					"amount":                      testCase.amount,
					"currency":                    testCase.currency,
					"episode_title":               testCase.episodeTitle,
					"expires_at":                  testCase.expiresAt,
					"is_test":                     testCase.isTest,
					"library_url":                 "https://reader.example.test/my/library",
					"purchased_at":                copyPurchasedAt,
					"series_title":                "The Lighthouse Keeper",
					"tenant_name":                 "Aoto Press",
					"volume_title":                testCase.volumeTitle,
					"series_bundle_episode_count": testCase.bundleCount,
					"coin_pack_coins":             testCase.coins,
					"coin_pack_bonus_coins":       testCase.bonusCoins,
					"coin_name":                   testCase.coinName,
					"coins_expire_at":             testCase.coinsExpireAt,
				},
				TimeZone: "Asia/Tokyo",
			})
			if err != nil {
				t.Fatalf("emailCopy: %v", err)
			}
			if email.Text != testCase.wantText {
				t.Errorf("text =\n%q\nwant\n%q", email.Text, testCase.wantText)
			}
		})
	}
}

// A notification mail names what it is about, links to it, and ends on where
// the reader chooses which mails they receive — except an announcement sent to
// every reader, which says so instead, since no setting could have stopped it.
// A title written over several lines is one line in the subject, which the
// SMTP client would otherwise refuse on every attempt.
func TestEmailCopyKeepsATitleOverSeveralLinesOnTheSubjectLine(t *testing.T) {
	for _, testCase := range []struct {
		name        string
		request     emailrenderer.Request
		wantSubject string
	}{
		{
			name: "an announcement title",
			request: emailrenderer.Request{
				Template: "reader_announcement_posted",
				Locale:   "en",
				Data: map[string]any{
					"announcement_title": "New terms \r\nof use",
					"announcements_url":  "https://reader.example.test/announcements",
					"sent_to_everyone":   true,
					"tenant_name":        "Aoto Press",
				},
			},
			wantSubject: "New terms of use",
		},
		{
			name: "a series title",
			request: emailrenderer.Request{
				Template: "reader_episode_published",
				Locale:   "en",
				Data: map[string]any{
					"episode_title": "The First Night",
					"episode_url":   "https://reader.example.test/series/S1/episodes/E1",
					"series_title":  "The Lighthouse\nKeeper",
					"settings_url":  "https://reader.example.test/settings/notifications",
					"tenant_name":   "Aoto Press",
				},
			},
			wantSubject: "The Lighthouse Keeper",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			email, err := emailCopy(testCase.request)
			if err != nil {
				t.Fatalf("emailCopy: %v", err)
			}
			if strings.ContainsAny(email.Subject, "\r\n") || !strings.Contains(email.Subject, testCase.wantSubject) {
				t.Fatalf("subject = %q, want one line naming %q", email.Subject, testCase.wantSubject)
			}
		})
	}
}

func TestEmailCopyWritesANotificationMail(t *testing.T) {
	for _, testCase := range []struct {
		name     string
		request  emailrenderer.Request
		wantText string
	}{
		{
			name: "an episode in English",
			request: emailrenderer.Request{
				Template: "reader_episode_published",
				Locale:   "en",
				Data: map[string]any{
					"episode_title": "The First Night",
					"episode_url":   "https://reader.example.test/series/S1/episodes/E1",
					"series_title":  "The Lighthouse Keeper",
					"settings_url":  "https://reader.example.test/settings/notifications",
					"tenant_name":   "Aoto Press",
				},
			},
			wantText: "Aoto Press\n\nA new episode has been published\n\n" +
				"Aoto Press published a new episode of a series or by an author you follow.\n\n" +
				"Series: The Lighthouse Keeper\n\nEpisode: The First Night\n\n" +
				"Read the episode https://reader.example.test/series/S1/episodes/E1\n\n" +
				"If the button does not work, paste this URL into your browser. https://reader.example.test/series/S1/episodes/E1\n\n" +
				"To choose which emails you receive, open your notification settings. https://reader.example.test/settings/notifications\n\n" +
				"This email was sent by Aoto Press.",
		},
		{
			name: "an announcement to everyone in Japanese",
			request: emailrenderer.Request{
				Template: "reader_announcement_posted",
				Locale:   "ja",
				Data: map[string]any{
					"announcement_title": "New terms of use",
					"announcements_url":  "https://reader.example.test/announcements",
					"sent_to_everyone":   true,
					"tenant_name":        "Aoto Press",
				},
			},
			wantText: "Aoto Press\n\n新しいお知らせ\n\n" +
				"Aoto Pressからお知らせが届きました。\n\n" +
				"タイトルは「New terms of use」です。\n\n" +
				"お知らせを読む https://reader.example.test/announcements\n\n" +
				"ボタンが使えない場合は、次のURLをブラウザに貼り付けてください。 https://reader.example.test/announcements\n\n" +
				"このお知らせは、通知設定にかかわらずAoto Pressのすべての読者に送信されています。\n\n" +
				"このメールはAoto Pressから送信されています。",
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			request := testCase.request
			request.TimeZone = "UTC"
			email, err := emailCopy(request)
			if err != nil {
				t.Fatalf("emailCopy: %v", err)
			}
			if email.Text != testCase.wantText {
				t.Errorf("text =\n%q\nwant\n%q", email.Text, testCase.wantText)
			}
		})
	}
}

// A mail whose copy is the platform's own names the platform rather than a
// tenant, above the card and again in the footer.
func TestEmailCopyBrandsAPlatformMailWithThePlatform(t *testing.T) {
	email, err := emailCopy(emailrenderer.Request{
		Template: "platform_console_email_changed_notice",
		Locale:   "en",
		Data:     map[string]any{"new_email": "new@example.com", "previous_email": "old@example.com"},
		TimeZone: "UTC",
	})
	if err != nil {
		t.Fatalf("emailCopy: %v", err)
	}
	want := "Publira\n\nYour Platform Console email address was changed\n\n" +
		"The email address on your Platform Console account was changed.\n\n" +
		"Before: old@example.com\n\nAfter: new@example.com\n\n" +
		"If you did not make this change, reset your password right away.\n\n" +
		"This email was sent by Publira."
	if email.Text != want {
		t.Errorf("text =\n%q\nwant\n%q", email.Text, want)
	}
}

// Every template in every language the platform serves: a key one catalog is
// missing would otherwise only surface as an unsent mail in that language.
func TestEmailCopyCoversEveryTemplateInEveryLocale(t *testing.T) {
	if len(emailCopyCases) < len(emailTemplates) {
		t.Fatalf("%d cases for %d templates", len(emailCopyCases), len(emailTemplates))
	}

	for _, testCase := range emailCopyCases {
		for _, code := range locale.Supported {
			t.Run(testCase.name+" in "+code, func(t *testing.T) {
				request := testCase.request
				request.Locale = code
				request.TimeZone = "UTC"

				email, err := emailCopy(request)
				if err != nil {
					t.Fatalf("emailCopy: %v", err)
				}
				if strings.TrimSpace(email.Subject) == "" {
					t.Error("the mail has no subject")
				}
				if want, ok := testCase.subjects[code]; ok && email.Subject != want {
					t.Errorf("subject = %q, want %q", email.Subject, want)
				}
				if strings.Contains(email.Text, "\n\n\n") {
					t.Errorf("the mail has an empty line: %q", email.Text)
				}
				for name, value := range request.Data {
					if strings.HasSuffix(name, "_url") && !strings.Contains(email.Text, value.(string)) {
						t.Errorf("the mail does not carry %s", name)
					}
				}
			})
		}
	}
}

func TestEmailCopyRefusesAMailItCannotWord(t *testing.T) {
	if _, err := emailCopy(emailrenderer.Request{Template: "welcome_back", Locale: "en"}); err == nil {
		t.Error("emailCopy accepted a template it has no copy for")
	}
	if _, err := emailCopy(emailrenderer.Request{
		Template: "reader_password_reset",
		Locale:   "en",
		Data:     map[string]any{"reset_url": "https://reader.example.test/confirm-password?token=reset"},
		TimeZone: "UTC",
	}); err == nil {
		t.Error("emailCopy accepted a request with no tenant_name")
	}
	if _, err := emailCopy(emailrenderer.Request{
		Template: "reader_password_reset",
		Locale:   "en",
		Data: map[string]any{
			"expires_at":  "the fifteenth",
			"reset_url":   "https://reader.example.test/confirm-password?token=reset",
			"tenant_name": "Aoto Press",
		},
		TimeZone: "UTC",
	}); err == nil {
		t.Error("emailCopy accepted an expiry that is not a timestamp")
	}
	if _, err := emailCopy(emailrenderer.Request{
		Template: "purchase_receipt",
		Locale:   "en",
		Data: map[string]any{
			"amount":        int64(500),
			"currency":      "XYZ",
			"episode_title": "Episode 1",
			"expires_at":    "",
			"is_test":       false,
			"library_url":   "https://reader.example.test/my/library",
			"purchased_at":  copyPurchasedAt,
			"series_title":  "The Lighthouse Keeper",
			"tenant_name":   "Aoto Press",
		},
		TimeZone: "UTC",
	}); err == nil {
		t.Error("emailCopy accepted a price in a currency it cannot write")
	}
}
