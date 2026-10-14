package locale

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	localegen "github.com/publira/publira/server/internal/locale/gen"
)

// ErrUnknownCurrency is returned for a currency the compiled tables do not
// carry. They hold every currency the runtime that generated them knows, which
// is the list the consoles offer, so this is a code no price could be set in.
var ErrUnknownCurrency = errors.New("no compiled format carries this currency")

// FormatPrice writes amount, an integer in the minor unit of currency, the way
// the locale code names writes that currency: 500 JPY is "￥500" in Japanese
// and 500 USD is "$5.00" in English. The tables are compiled from the same
// CLDR data formatPrice in `@publira/utils` reads, so a price reads the same on
// a screen and in the mail that confirms it.
func FormatPrice(amount int64, currency, code string) (string, error) {
	formats, ok := localegen.CurrencyFormats[code]
	if !ok {
		return "", fmt.Errorf("%w: %s", ErrUnresolved, code)
	}
	symbols := localegen.LocaleNumberSymbols[code]
	affixes, ok := formats[currency]
	if !ok {
		return "", fmt.Errorf("%w: %s", ErrUnknownCurrency, currency)
	}
	if amount < 0 {
		return "", fmt.Errorf("a price cannot be negative: %d", amount)
	}

	digits := localegen.CurrencyDigits[currency]
	scale := int64(1)
	for range digits {
		scale *= 10
	}
	integer := strconv.FormatInt(amount/scale, 10)

	var written strings.Builder
	written.WriteString(affixes.Prefix)
	for index, digit := range integer {
		if index > 0 && (len(integer)-index)%localegen.GroupSize == 0 {
			written.WriteString(symbols.Group)
		}
		written.WriteRune(digit)
	}
	if digits > 0 {
		written.WriteString(symbols.Decimal)
		fraction := strconv.FormatInt(amount%scale, 10)
		written.WriteString(strings.Repeat("0", digits-len(fraction)))
		written.WriteString(fraction)
	}
	written.WriteString(affixes.Suffix)
	return written.String(), nil
}
