package config

import (
	"encoding/base64"
	"fmt"
	"os"
	"strings"
)

const defaultDBURL = "postgres://postgres:password@db:5432/publira?sslmode=disable"

type Config struct {
	DB         DB
	Encryption Encryption
}

type DB struct {
	// URL is the generic DB connection string (used by migration tools and worker jobs).
	URL string
}

type Encryption struct {
	PrimaryKeyID string
	Keys         map[string][]byte
}

func New() (*Config, error) {
	encryptionCfg, err := parseEncryption()
	if err != nil {
		return nil, err
	}
	return &Config{
		DB:         parseDB(),
		Encryption: encryptionCfg,
	}, nil
}

func parseDB() DB {
	dbURL := strings.TrimSpace(os.Getenv("PUBLIRA_DB_URL"))
	if dbURL == "" {
		dbURL = defaultDBURL
	}
	return DB{URL: dbURL}
}

func parseEncryption() (Encryption, error) {
	rawKeys := strings.TrimSpace(os.Getenv("PUBLIRA_SECRET_ENCRYPTION_KEYS"))
	primaryKeyID := strings.TrimSpace(os.Getenv("PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID"))

	if rawKeys == "" && primaryKeyID == "" {
		return Encryption{}, nil
	}
	if rawKeys == "" {
		return Encryption{}, fmt.Errorf("PUBLIRA_SECRET_ENCRYPTION_KEYS is required when PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID is set")
	}
	if primaryKeyID == "" {
		return Encryption{}, fmt.Errorf("PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID is required when PUBLIRA_SECRET_ENCRYPTION_KEYS is set")
	}

	keys := make(map[string][]byte)
	positions := make(map[string]int)
	for i, entry := range strings.Split(rawKeys, ",") {
		position := i + 1
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}

		// An entry missing its key id or its key may be nothing but the key, so
		// these errors name the entry by its position and quote none of it. The
		// key id is quoted only once both halves are present.
		keyID, encodedKey, found := strings.Cut(entry, ":")
		if !found {
			return Encryption{}, fmt.Errorf("entry %d of PUBLIRA_SECRET_ENCRYPTION_KEYS is not in key-id:base64key form", position)
		}
		keyID = strings.TrimSpace(keyID)
		encodedKey = strings.TrimSpace(encodedKey)
		if keyID == "" {
			return Encryption{}, fmt.Errorf("entry %d of PUBLIRA_SECRET_ENCRYPTION_KEYS has no key id", position)
		}
		if encodedKey == "" {
			return Encryption{}, fmt.Errorf("entry %d of PUBLIRA_SECRET_ENCRYPTION_KEYS has no key", position)
		}

		if previous, ok := positions[keyID]; ok {
			return Encryption{}, fmt.Errorf("key id %q appears in both entry %d and entry %d of PUBLIRA_SECRET_ENCRYPTION_KEYS", keyID, previous, position)
		}

		decodedKey, err := base64.RawURLEncoding.DecodeString(encodedKey)
		if err != nil {
			decodedKey, err = base64.StdEncoding.DecodeString(encodedKey)
			if err != nil {
				return Encryption{}, fmt.Errorf("invalid base64 key for %q in entry %d of PUBLIRA_SECRET_ENCRYPTION_KEYS", keyID, position)
			}
		}

		keyLen := len(decodedKey)
		if keyLen != 16 && keyLen != 24 && keyLen != 32 {
			return Encryption{}, fmt.Errorf("invalid key length for %q in entry %d of PUBLIRA_SECRET_ENCRYPTION_KEYS: %d", keyID, position, keyLen)
		}
		keys[keyID] = decodedKey
		positions[keyID] = position
	}

	if len(keys) == 0 {
		return Encryption{}, fmt.Errorf("PUBLIRA_SECRET_ENCRYPTION_KEYS is required")
	}
	if _, ok := keys[primaryKeyID]; !ok {
		return Encryption{}, fmt.Errorf("PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID %q is not present in PUBLIRA_SECRET_ENCRYPTION_KEYS", primaryKeyID)
	}

	return Encryption{
		PrimaryKeyID: primaryKeyID,
		Keys:         keys,
	}, nil
}
