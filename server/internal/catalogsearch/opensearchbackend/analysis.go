package opensearchbackend

import (
	"bytes"
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"

	"github.com/opensearch-project/opensearch-go/v5/opensearchapi"
)

// The names the mapping refers to, which every analysis definition has to
// define. Each names the role it plays rather than a language, so a definition
// written for another language fills the same mapping.
const (
	// AnalyzerWrittenForm analyzes the title, the name, and the synopsis as
	// they are written.
	AnalyzerWrittenForm = "written_form"
	// AnalyzerAlternateForm analyzes the alternate form a query may be typed
	// in: the title's and the name's reading sub-fields, and the reading an
	// administrator entered. A definition with no alternate form for its
	// language makes it the written form again.
	AnalyzerAlternateForm = "alternate_form"
	// NormalizerExactMatch normalizes the keyword sub-fields, the exact match
	// and the sort key of a ranked search.
	NormalizerExactMatch = "exact_match"
)

// MaxAnalysisBytes bounds a definition as it is given. The default is under
// 2 KiB; the bound leaves room for a user dictionary written inline.
const MaxAnalysisBytes = 64 << 10

// defaultAnalysis is the settings.analysis of the catalog index when the
// platform has saved none, built for Japanese.
//
// The written form keeps the text as it is written: the kuromoji tokenizer in
// search mode splits a compound into its parts as well, icu_normalizer (NFKC
// with case folding) and cjk_width make full-width Latin and half-width kana
// the same token as their usual forms, and kuromoji_baseform lets an inflected
// verb match its dictionary form.
//
// The alternate form is the reading, which a query typed in kana meets a
// title written in kanji through, and it is also how an entered reading is
// analyzed. It replaces each token with its reading in katakana, turns the
// hiragana of a token the dictionary has no reading for into katakana, and
// indexes the result as overlapping pairs of characters. The pairs are taken
// across each two neighbouring tokens as well, because the dictionary splits
// a run of kana where it pleases: 「ぎんがてつどう」 comes out as
// ギン/ガ/テツ/ドウ where 「銀河鉄道」 comes out as ギンガ/テツドウ, and only
// the pairs of the joined reading are the same for both.
//
// The exact match is normalized the way the text is, so neither it nor the
// order of the hits of one score depends on case or width.
//
//go:embed analysis.json
var defaultAnalysis []byte

// DefaultAnalysis is the definition an index is built with when the platform
// has saved none, as JSON.
func DefaultAnalysis() []byte {
	return bytes.Clone(defaultAnalysis)
}

// ErrAnalysisTooLarge refuses a definition over MaxAnalysisBytes.
var ErrAnalysisTooLarge = fmt.Errorf("the analysis definition is larger than %d KiB", MaxAnalysisBytes>>10)

// errAnalysisNotObject refuses a definition that is not one JSON object.
var errAnalysisNotObject = errors.New("the analysis definition is not a JSON object")

// MissingRoleError refuses a definition that does not define one of the names
// the mapping refers to.
type MissingRoleError struct {
	// Section is "analyzer" or "normalizer".
	Section string
	Name    string
}

func (e *MissingRoleError) Error() string {
	return fmt.Sprintf("the analysis definition defines no %s %q, which the catalog mapping refers to", e.Section, e.Name)
}

// ParseAnalysis reads a definition of the index's settings.analysis, refusing
// one that is too large, is not a JSON object, or does not define every role,
// and answers it compacted with its keys sorted, so two spellings of one
// definition compare equal. Whether the engine accepts what each role is made
// of is for [CheckAnalysis] to find out.
func ParseAnalysis(raw []byte) (string, error) {
	if len(raw) > MaxAnalysisBytes {
		return "", ErrAnalysisTooLarge
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	// Numbers are kept as they are written: a float64 would round a large
	// integer and spell another.
	decoder.UseNumber()
	var analysis map[string]any
	if err := decoder.Decode(&analysis); err != nil || analysis == nil {
		return "", errAnalysisNotObject
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		return "", errAnalysisNotObject
	}
	for _, role := range []MissingRoleError{
		{Section: "analyzer", Name: AnalyzerWrittenForm},
		{Section: "analyzer", Name: AnalyzerAlternateForm},
		{Section: "normalizer", Name: NormalizerExactMatch},
	} {
		section, _ := analysis[role.Section].(map[string]any)
		if _, ok := section[role.Name].(map[string]any); !ok {
			return "", &role
		}
	}
	canonical, err := json.Marshal(analysis)
	if err != nil {
		return "", fmt.Errorf("opensearchbackend: encode the analysis definition: %w", err)
	}
	return string(canonical), nil
}

// mappings is the mapping of the catalog index. The searches name its fields
// and the documents are written to it, so it is the code's alone; what a
// platform may replace is the analysis it refers to.
//
//go:embed mappings.json
var mappings []byte

// indexDefinition is the body that creates a catalog index with analysis, or
// with the default where analysis is empty, and behind alias where one is
// given.
func indexDefinition(analysis, alias string) ([]byte, error) {
	settings := json.RawMessage(defaultAnalysis)
	if analysis != "" {
		settings = json.RawMessage(analysis)
	}
	definition := map[string]any{
		"settings": map[string]any{"analysis": settings},
		"mappings": json.RawMessage(mappings),
	}
	if alias != "" {
		definition["aliases"] = map[string]any{alias: map[string]any{}}
	}
	body, err := json.Marshal(definition)
	if err != nil {
		return nil, fmt.Errorf("opensearchbackend: encode index definition: %w", err)
	}
	return body, nil
}

// AnalysisRefusedError is a definition the engine refused to create an index
// with, carrying the engine's reason.
type AnalysisRefusedError struct {
	Reason string
}

func (e *AnalysisRefusedError) Error() string {
	return "the search engine refused the analysis definition: " + e.Reason
}

// scratchIndexInfix names the index CheckAnalysis creates after the alias, so
// it sits beside the catalog's own indices and the cleanup that deletes them
// deletes it too.
const scratchIndexInfix = "-analysis-check-"

// CheckAnalysis creates an empty index beside cfg's alias with cfg's analysis
// and the catalog mapping, and deletes it again, which is how a definition is
// found to be one the engine builds the catalog index from before anything
// depends on it. A refusal is an [*AnalysisRefusedError]; any other error is
// an engine that could not be asked.
func CheckAnalysis(ctx context.Context, cfg Config) error {
	client, err := newClient(cfg)
	if err != nil {
		return err
	}
	body, err := indexDefinition(cfg.Analysis, "")
	if err != nil {
		return err
	}
	suffix := make([]byte, 8)
	_, _ = rand.Read(suffix)
	name := cfg.Index + scratchIndexInfix + hex.EncodeToString(suffix)

	// Sent as a plain request, so the whole answer is read: OpenSearch says
	// what is wrong with an analyzer in the suppressed errors beside the one
	// it names, which the client's error type leaves out.
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, "/"+name, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("opensearchbackend: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Client.Request(req)
	if err != nil {
		return fmt.Errorf("opensearchbackend: create the scratch index %q: %w", name, err)
	}
	answer, err := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if err != nil {
		return fmt.Errorf("opensearchbackend: create the scratch index %q: %w", name, err)
	}
	switch {
	case resp.StatusCode/100 == 2:
	case resp.StatusCode/100 == 4 && resp.StatusCode != http.StatusUnauthorized && resp.StatusCode != http.StatusForbidden:
		return &AnalysisRefusedError{Reason: engineReason(answer)}
	default:
		return fmt.Errorf("opensearchbackend: create the scratch index %q: status %d: %s", name, resp.StatusCode, engineReason(answer))
	}
	if _, err := client.Indices.Delete(context.WithoutCancel(ctx), &opensearchapi.IndicesDeleteReq{Indices: []string{name}}); err != nil {
		return fmt.Errorf("opensearchbackend: the analysis definition was accepted, but deleting the scratch index %q failed: %w", name, err)
	}
	return nil
}

// engineError is an error the engine answers with, as much of it as says what
// went wrong.
type engineError struct {
	Type       string        `json:"type"`
	Reason     string        `json:"reason"`
	CausedBy   *engineError  `json:"caused_by"`
	Suppressed []engineError `json:"suppressed"`
}

// engineReason is every distinct reason in the error the engine answered:
// a refused definition often names the analyzer at the top and what is wrong
// with it underneath, in a cause or in a suppressed error. An answer that is
// not such an error is given as it came.
func engineReason(answer []byte) string {
	var parsed struct {
		Error *engineError `json:"error"`
	}
	if err := json.Unmarshal(answer, &parsed); err != nil || parsed.Error == nil {
		return strings.TrimSpace(string(answer))
	}
	var reasons []string
	var collect func(e *engineError)
	collect = func(e *engineError) {
		for ; e != nil; e = e.CausedBy {
			reason := e.Type + ": " + e.Reason
			if !slices.Contains(reasons, reason) {
				reasons = append(reasons, reason)
			}
			for i := range e.Suppressed {
				collect(&e.Suppressed[i])
			}
		}
	}
	collect(parsed.Error)
	return strings.Join(reasons, "; ")
}
