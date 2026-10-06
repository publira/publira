package opensearchbackend

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

// koreanAnalysis is a definition built on analysis-nori, with the written form
// as its alternate form: Korean has no reading of its own to match a title by.
const koreanAnalysis = `{
  "analyzer": {
    "written_form": {"type": "custom", "tokenizer": "nori_tokenizer", "filter": ["nori_part_of_speech", "lowercase"]},
    "alternate_form": {"type": "custom", "tokenizer": "nori_tokenizer", "filter": ["nori_part_of_speech", "lowercase"]}
  },
  "normalizer": {"exact_match": {"type": "custom", "filter": ["lowercase"]}}
}`

// chineseAnalysis is a definition built on analysis-smartcn, the same way.
const chineseAnalysis = `{
  "analyzer": {
    "written_form": {"type": "custom", "tokenizer": "smartcn_tokenizer", "filter": ["lowercase"]},
    "alternate_form": {"type": "custom", "tokenizer": "smartcn_tokenizer", "filter": ["lowercase"]}
  },
  "normalizer": {"exact_match": {"type": "custom", "filter": ["lowercase"]}}
}`

func TestTheDefaultAnalysisDefinesEveryRole(t *testing.T) {
	t.Parallel()

	if _, err := ParseAnalysis(DefaultAnalysis()); err != nil {
		t.Fatalf("ParseAnalysis(default): %v", err)
	}
}

// Every analyzer and normalizer the mapping names is a role a definition has
// to define, so the list ParseAnalysis checks cannot fall behind the mapping.
func TestTheMappingRefersToTheRolesAlone(t *testing.T) {
	t.Parallel()

	var walk func(value any, names map[string]bool)
	walk = func(value any, names map[string]bool) {
		switch value := value.(type) {
		case map[string]any:
			for key, child := range value {
				if name, ok := child.(string); ok && (key == "analyzer" || key == "normalizer" || key == "search_analyzer") {
					names[key+" "+name] = true
				}
				walk(child, names)
			}
		case []any:
			for _, child := range value {
				walk(child, names)
			}
		}
	}
	var mapping any
	if err := json.Unmarshal(mappings, &mapping); err != nil {
		t.Fatal(err)
	}
	names := map[string]bool{}
	walk(mapping, names)
	want := map[string]bool{
		"analyzer " + AnalyzerWrittenForm:    true,
		"analyzer " + AnalyzerAlternateForm:  true,
		"normalizer " + NormalizerExactMatch: true,
	}
	if len(names) != len(want) {
		t.Fatalf("the mapping refers to %v, want %v", names, want)
	}
	for name := range names {
		if !want[name] {
			t.Fatalf("the mapping refers to %s, which is no role", name)
		}
	}
}

func TestParseAnalysisCompactsAndSortsADefinition(t *testing.T) {
	t.Parallel()

	got, err := ParseAnalysis([]byte(koreanAnalysis))
	if err != nil {
		t.Fatalf("ParseAnalysis: %v", err)
	}
	if strings.ContainsAny(got, "\n ") || !strings.HasPrefix(got, `{"analyzer":{"alternate_form":`) {
		t.Fatalf("ParseAnalysis = %s, want it compacted with its keys sorted", got)
	}
	again, err := ParseAnalysis([]byte(got))
	if err != nil || again != got {
		t.Fatalf("ParseAnalysis of its own answer = (%s, %v), want it unchanged", again, err)
	}
	withNumber, err := ParseAnalysis([]byte(`{"analyzer":{"written_form":{"max":12345678901234567890},"alternate_form":{}},"normalizer":{"exact_match":{}}}`))
	if err != nil || !strings.Contains(withNumber, "12345678901234567890") {
		t.Fatalf("ParseAnalysis = (%s, %v), want the number spelled as given", withNumber, err)
	}
}

func TestParseAnalysisRefusesADefinitionTheMappingCannotUse(t *testing.T) {
	t.Parallel()

	for name, test := range map[string]struct {
		raw  string
		want error
	}{
		"not JSON":           {raw: `{"analyzer":`, want: errAnalysisNotObject},
		"an array":           {raw: `[]`, want: errAnalysisNotObject},
		"null":               {raw: `null`, want: errAnalysisNotObject},
		"two values":         {raw: `{} {}`, want: errAnalysisNotObject},
		"the whole settings": {raw: `{"analysis":` + koreanAnalysis + `}`, want: &MissingRoleError{Section: "analyzer", Name: AnalyzerWrittenForm}},
		"no alternate form": {
			raw:  `{"analyzer":{"written_form":{"type":"standard"}},"normalizer":{"exact_match":{"type":"custom"}}}`,
			want: &MissingRoleError{Section: "analyzer", Name: AnalyzerAlternateForm},
		},
		"no exact match": {
			raw:  `{"analyzer":{"written_form":{"type":"standard"},"alternate_form":{"type":"standard"}}}`,
			want: &MissingRoleError{Section: "normalizer", Name: NormalizerExactMatch},
		},
		"a role that is not an object": {
			raw:  `{"analyzer":{"written_form":"standard","alternate_form":{"type":"standard"}},"normalizer":{"exact_match":{"type":"custom"}}}`,
			want: &MissingRoleError{Section: "analyzer", Name: AnalyzerWrittenForm},
		},
		"too large": {raw: `{"x":"` + strings.Repeat("a", MaxAnalysisBytes) + `"}`, want: ErrAnalysisTooLarge},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			_, err := ParseAnalysis([]byte(test.raw))
			var missing *MissingRoleError
			if want, ok := test.want.(*MissingRoleError); ok {
				if !errors.As(err, &missing) || *missing != *want {
					t.Fatalf("ParseAnalysis error = %v, want %v", err, want)
				}
				return
			}
			if !errors.Is(err, test.want) {
				t.Fatalf("ParseAnalysis error = %v, want %v", err, test.want)
			}
		})
	}
}

func TestIndexDefinitionTakesTheAnalysisGivenOrTheDefault(t *testing.T) {
	t.Parallel()

	analysisOf := func(body []byte) string {
		t.Helper()
		var definition struct {
			Settings struct {
				Analysis json.RawMessage `json:"analysis"`
			} `json:"settings"`
			Aliases map[string]json.RawMessage `json:"aliases"`
		}
		if err := json.Unmarshal(body, &definition); err != nil {
			t.Fatal(err)
		}
		canonical, err := ParseAnalysis(definition.Settings.Analysis)
		if err != nil {
			t.Fatal(err)
		}
		return canonical
	}
	korean, err := ParseAnalysis([]byte(koreanAnalysis))
	if err != nil {
		t.Fatal(err)
	}
	defaultCanonical, err := ParseAnalysis(DefaultAnalysis())
	if err != nil {
		t.Fatal(err)
	}

	body, err := indexDefinition(korean, "")
	if err != nil {
		t.Fatal(err)
	}
	if got := analysisOf(body); got != korean {
		t.Fatalf("analysis = %s, want %s", got, korean)
	}
	body, err = indexDefinition("", "catalog")
	if err != nil {
		t.Fatal(err)
	}
	if got := analysisOf(body); got != defaultCanonical {
		t.Fatalf("analysis = %s, want the default", got)
	}
	if !strings.Contains(string(body), `"aliases":{"catalog":{}}`) {
		t.Fatalf("definition %s names no alias catalog", body)
	}
}

func TestEngineReasonNamesEveryCause(t *testing.T) {
	t.Parallel()

	for name, test := range map[string]struct {
		answer string
		want   string
	}{
		"suppressed": {
			answer: `{"error":{"root_cause":[],"type":"illegal_argument_exception","reason":"Failed to build analyzers: [written_form]","suppressed":[{"type":"illegal_argument_exception","reason":"[written_form] failed to find tokenizer under name [x]","caused_by":{"type":"illegal_argument_exception","reason":"failed to find tokenizer under name [x]"}}]},"status":400}`,
			want:   "illegal_argument_exception: Failed to build analyzers: [written_form]; illegal_argument_exception: [written_form] failed to find tokenizer under name [x]; illegal_argument_exception: failed to find tokenizer under name [x]",
		},
		"caused by, repeated": {
			answer: `{"error":{"type":"a","reason":"b","caused_by":{"type":"a","reason":"b","caused_by":{"type":"c","reason":"d"}}}}`,
			want:   "a: b; c: d",
		},
		"not an error": {answer: " Bad Gateway\n", want: "Bad Gateway"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			if got := engineReason([]byte(test.answer)); got != test.want {
				t.Fatalf("engineReason = %q, want %q", got, test.want)
			}
		})
	}
}
