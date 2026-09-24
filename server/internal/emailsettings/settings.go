package emailsettings

import (
	"errors"
	"net/mail"
	"strings"

	"github.com/publira/publira/server/internal/secretupdate"
)

const (
	TestRecipientTypeUnspecified int32 = 0
	TestRecipientTypeSelf        int32 = 1
	TestRecipientTypeCustom      int32 = 2
)

var (
	ErrSecretManagerUnavailable = errors.New("secret manager is not configured")
	ErrPasswordRequired         = errors.New("password is required")
	ErrInvalidRecipient         = errors.New("invalid recipient")
)

type SecretManager interface {
	EncryptString(plaintext string) (string, error)
	DecryptString(value string) (string, error)
}

type SMTPSettings struct {
	Host        string
	Port        int32
	Username    string
	Password    string
	Encryption  string
	FromName    string
	FromAddress string
	ReplyTo     string
}

func Normalize(settings SMTPSettings) SMTPSettings {
	settings.Host = strings.TrimSpace(settings.Host)
	settings.Username = strings.TrimSpace(settings.Username)
	settings.Encryption = strings.ToLower(strings.TrimSpace(settings.Encryption))
	settings.FromName = strings.TrimSpace(settings.FromName)
	settings.FromAddress = strings.TrimSpace(settings.FromAddress)
	settings.ReplyTo = strings.TrimSpace(settings.ReplyTo)
	return settings
}

func Validate(settings SMTPSettings, requirePassword bool) error {
	settings = Normalize(settings)
	if settings.Host == "" {
		return errors.New("host is required")
	}
	if settings.Port < 1 || settings.Port > 65535 {
		return errors.New("port must be between 1 and 65535")
	}
	if settings.Username == "" {
		return errors.New("username is required")
	}
	if requirePassword && settings.Password == "" {
		return ErrPasswordRequired
	}
	if !isSupportedEncryption(settings.Encryption) {
		return errors.New("encryption must be one of tls, starttls, none")
	}
	if _, err := mail.ParseAddress(settings.FromAddress); err != nil {
		return errors.New("from_address must be a valid email address")
	}
	if settings.ReplyTo != "" {
		if _, err := mail.ParseAddress(settings.ReplyTo); err != nil {
			return errors.New("reply_to must be a valid email address")
		}
	}
	return nil
}

func ValidateOptional(settings SMTPSettings, hasPassword bool) error {
	settings = Normalize(settings)
	if settings.Port != 0 && (settings.Port < 1 || settings.Port > 65535) {
		return errors.New("port must be between 1 and 65535")
	}
	if settings.Encryption != "" && !isSupportedEncryption(settings.Encryption) {
		return errors.New("encryption must be one of tls, starttls, none")
	}
	if settings.FromAddress != "" {
		if _, err := mail.ParseAddress(settings.FromAddress); err != nil {
			return errors.New("from_address must be a valid email address")
		}
	}
	if settings.ReplyTo != "" {
		if _, err := mail.ParseAddress(settings.ReplyTo); err != nil {
			return errors.New("reply_to must be a valid email address")
		}
	}
	if strings.TrimSpace(settings.Password) != "" && !hasPassword {
		return ErrPasswordRequired
	}
	return nil
}

func HasAnyValue(settings SMTPSettings, hasPassword bool) bool {
	settings = Normalize(settings)
	return settings.Host != "" ||
		settings.Port != 0 ||
		settings.Username != "" ||
		settings.Encryption != "" ||
		settings.FromName != "" ||
		settings.FromAddress != "" ||
		settings.ReplyTo != "" ||
		hasPassword
}

func EncryptUpdatedPassword(existingEncrypted string, mode secretupdate.Mode, newPassword string, mgr SecretManager) (string, bool, error) {
	resolved, err := secretupdate.Resolve(mode, newPassword, ErrPasswordRequired)
	if err != nil {
		return "", false, err
	}
	switch resolved {
	case secretupdate.Replace:
		if mgr == nil {
			return "", false, ErrSecretManagerUnavailable
		}
		encrypted, err := mgr.EncryptString(newPassword)
		if err != nil {
			return "", false, err
		}
		return encrypted, true, nil
	case secretupdate.Clear:
		return "", false, nil
	default:
		return existingEncrypted, existingEncrypted != "", nil
	}
}

func ResolvePasswordForTest(existingEncrypted string, mode secretupdate.Mode, newPassword string, mgr SecretManager) (string, error) {
	resolved, err := secretupdate.Resolve(mode, newPassword, ErrPasswordRequired)
	if err != nil {
		return "", err
	}
	switch resolved {
	case secretupdate.Replace:
		return newPassword, nil
	case secretupdate.Clear:
		return "", ErrPasswordRequired
	default:
		return DecryptPassword(existingEncrypted, mgr)
	}
}

func DecryptPassword(encrypted string, mgr SecretManager) (string, error) {
	if strings.TrimSpace(encrypted) == "" {
		return "", ErrPasswordRequired
	}
	if mgr == nil {
		return "", ErrSecretManagerUnavailable
	}
	return mgr.DecryptString(encrypted)
}

func ResolveRecipient(recipientType int32, customEmail, selfEmail string) (string, error) {
	switch recipientType {
	case TestRecipientTypeSelf:
		selfEmail = strings.TrimSpace(selfEmail)
		if _, err := mail.ParseAddress(selfEmail); err != nil {
			return "", ErrInvalidRecipient
		}
		return selfEmail, nil
	case TestRecipientTypeCustom:
		customEmail = strings.TrimSpace(customEmail)
		if _, err := mail.ParseAddress(customEmail); err != nil {
			return "", ErrInvalidRecipient
		}
		return customEmail, nil
	default:
		return "", ErrInvalidRecipient
	}
}

func isSupportedEncryption(value string) bool {
	switch value {
	case "tls", "starttls", "none":
		return true
	default:
		return false
	}
}
