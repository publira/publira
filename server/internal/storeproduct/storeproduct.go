// Package storeproduct names the consumable product a store sells an episode
// or a pack of coins as. An episode's product is a price tier rather than an
// episode, so a tenant creates one per price in App Store Connect and the Play
// Console, under the same ID in both, and one more per pack.
package storeproduct

import (
	"encoding/hex"
	"strconv"

	"github.com/google/uuid"
)

// ProductID is the product an episode priced at price, in the minor unit of the
// tenant currency, is bought as. The ID names no currency: the tenant has one,
// and the store sets what each storefront charges for the product.
func ProductID(price int32) string {
	return "episode_" + strconv.FormatInt(int64(price), 10)
}

// CoinPackProductID is the product a pack of a tenant's coins is bought as,
// named by the pack rather than its price: two packs may share a price and
// grant different coins. Google Play takes a product ID of digits, lowercase
// letters, underscores, and periods alone, so the pack is named by its UUID in
// lowercase hexadecimal rather than by its public ID, whose Base58 tells
// letters apart by case and could not be lowercased without two packs
// colliding.
func CoinPackProductID(packID uuid.UUID) string {
	return "coins_" + hex.EncodeToString(packID[:])
}
