package outbox

import (
	"strings"
	"testing"

	"github.com/publira/publira/server/internal/emailrenderer"
	"github.com/publira/publira/server/internal/locale"
)

const copyExpiresAt = "2030-01-15T12:00:00Z"

// emailCopyCases is one request per template the worker sends, and one more for
// each template whose copy branches on a value the sender supplies.
var emailCopyCases = []struct {
	name     string
	subjects map[string]string
	request  emailrenderer.Request
}{
	{
		name:     "tenant_admin_invitation",
		subjects: map[string]string{"en": "Aoto Press admin invitation", "ja": "Aoto Press 管理者招待"},
		request: emailrenderer.Request{
			Template: "tenant_admin_invitation",
			Data: map[string]any{
				"expires_at":  copyExpiresAt,
				"invite_url":  "https://admin.example.test/accept-invite?token=invite",
				"tenant_name": "Aoto Press",
			},
		},
	},
	{
		name:     "reader_email_verification",
		subjects: map[string]string{"en": "Aoto Press email address verification", "ja": "Aoto Press メールアドレス確認"},
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
		subjects: map[string]string{"en": "Aoto Press email address change confirmation", "ja": "Aoto Press メールアドレス変更確認"},
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
		subjects: map[string]string{"en": "Aoto Press email address change confirmation", "ja": "Aoto Press メールアドレス変更確認"},
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
		subjects: map[string]string{"en": "Aoto Press email address changed", "ja": "Aoto Press メールアドレス変更完了"},
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
		subjects: map[string]string{"en": "Aoto Press password reset", "ja": "Aoto Press パスワード再設定"},
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
		subjects: map[string]string{"en": "Aoto Press password changed", "ja": "Aoto Press パスワード変更完了"},
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
		subjects: map[string]string{"en": "Aoto Press sign-up attempt", "ja": "Aoto Press アカウント登録の試行"},
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
		subjects: map[string]string{"en": "Aoto Press sign-up attempt", "ja": "Aoto Press アカウント登録の試行"},
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
		subjects: map[string]string{"en": "Aoto Press admin console email address change confirmation", "ja": "Aoto Press 管理画面メールアドレス変更確認"},
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
		subjects: map[string]string{"en": "Aoto Press admin console email address changed", "ja": "Aoto Press 管理画面メールアドレス変更完了"},
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
		subjects: map[string]string{"en": "Aoto Press admin console password reset", "ja": "Aoto Press 管理画面パスワード再設定"},
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
		subjects: map[string]string{"en": "Publira Platform Console email address change confirmation", "ja": "Publira Platform Console メールアドレス変更確認"},
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
		subjects: map[string]string{"en": "Publira Platform Console email address changed", "ja": "Publira Platform Console メールアドレス変更完了"},
		request: emailrenderer.Request{
			Template: "platform_console_email_changed_notice",
			Data: map[string]any{
				"new_email":      "new@example.com",
				"previous_email": "old@example.com",
			},
		},
	},
	{
		name:     "platform_console_password_reset",
		subjects: map[string]string{"en": "Publira Platform Console password reset", "ja": "Publira Platform Console パスワード再設定"},
		request: emailrenderer.Request{
			Template: "platform_console_password_reset",
			Data: map[string]any{
				"expires_at": copyExpiresAt,
				"reset_url":  "https://platform.example.test/confirm-password?token=reset",
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
				"This link expires at Jan 15, 2030, 9:00\u202fPM.\n\n" +
				"If you were not expecting this email, you can ignore it.\n\n" +
				"If the button does not work, paste this URL into your browser. https://reader.example.test/confirm-password?token=reset\n\n" +
				"This email was sent by Aoto Press.",
		},
		{
			locale:      "ja",
			wantSubject: "Aoto Press パスワード再設定",
			wantText: "Aoto Press\n\nパスワードの再設定\n\n" +
				"パスワード再設定のリクエストを受け付けました。\n\n" +
				"以下のボタンから新しいパスワードを設定してください。\n\n" +
				"パスワードを再設定する https://reader.example.test/confirm-password?token=reset\n\n" +
				"このリンクの有効期限は 2030/01/15 21:00 です。\n\n" +
				"心当たりがない場合、このメールは破棄してください。\n\n" +
				"ボタンが使えない場合は、次の URL をブラウザに貼り付けてください。 https://reader.example.test/confirm-password?token=reset\n\n" +
				"このメールは Aoto Press から送信されています。",
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
				TimeZone: "Asia/Tokyo",
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

// A mail whose copy is the platform's own names the platform rather than a
// tenant, above the card and again in the footer.
func TestEmailCopyBrandsAPlatformMailWithThePlatform(t *testing.T) {
	email, err := emailCopy(emailrenderer.Request{
		Template: "platform_console_email_changed_notice",
		Locale:   "en",
		Data:     map[string]any{"new_email": "new@example.com", "previous_email": "old@example.com"},
		TimeZone: "Asia/Tokyo",
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
				request.TimeZone = "Asia/Tokyo"

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
		TimeZone: "Asia/Tokyo",
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
		TimeZone: "Asia/Tokyo",
	}); err == nil {
		t.Error("emailCopy accepted an expiry that is not a timestamp")
	}
}
