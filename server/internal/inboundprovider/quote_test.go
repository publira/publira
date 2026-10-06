package inboundprovider

import "testing"

func TestStripQuoted(t *testing.T) {
	cases := []struct {
		name string
		text string
		want string
	}{
		{
			name: "a reply above a quotation and its attribution",
			text: "It works now.\n\nOn Mon, Oct 5, 2026 at 6:30 PM Example <contact@reply.example.com> wrote:\n> Please try again.\n> \n",
			want: "It works now.",
		},
		{
			name: "an attribution wrapped onto a second line",
			text: "It works now.\r\n\r\nOn Mon, Oct 5, 2026 at 6:30 PM Example Comics <contact+7Hn3QzW9kPfa@reply.example.com>\r\nwrote:\r\n\r\n> Please try again.\r\n",
			want: "It works now.",
		},
		{
			name: "a quotation with no attribution",
			text: "It works now.\n> Please try again.",
			want: "It works now.",
		},
		{
			name: "a quotation the reader interleaved with their own lines",
			text: "> Which device?\nMy tablet.\n> Which episode?\nEpisode 3.",
			want: "> Which device?\nMy tablet.\n> Which episode?\nEpisode 3.",
		},
		{
			name: "an interleaved reply still loses the quotation below it",
			text: "> Which device?\nMy tablet.\n\nOn Mon, Oct 5, 2026, Example <contact@reply.example.com> wrote:\n> Which device?\n> Which episode?",
			want: "> Which device?\nMy tablet.",
		},
		{
			name: "an Outlook original message block",
			text: "It works now.\n\n-----Original Message-----\nFrom: Example <contact@reply.example.com>\nSent: Monday\n\nPlease try again.",
			want: "It works now.",
		},
		{
			name: "an Outlook on the web rule above a From line",
			text: "It works now.\n\n________________________________\nFrom: Example <contact@reply.example.com>\nSent: Monday\n\nPlease try again.",
			want: "It works now.",
		},
		{
			name: "a rule the reader drew themselves",
			text: "First point.\n\n________________________________\nSecond point.",
			want: "First point.\n\n________________________________\nSecond point.",
		},
		{
			name: "a line ending in a colon that is not an attribution",
			text: "Here is what I see:\n> Error 403",
			want: "Here is what I see:",
		},
		{
			name: "nothing but a quotation",
			text: "> Please try again.",
			want: "",
		},
		{
			name: "no quotation",
			text: "  It works now.\n\nThanks  ",
			want: "It works now.\n\nThanks",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := StripQuoted(tc.text); got != tc.want {
				t.Fatalf("StripQuoted(%q) = %q, want %q", tc.text, got, tc.want)
			}
		})
	}
}

// What is under test is the handling of an attribution written in Japanese,
// with a full-width colon, which Japanese mail clients write.
func TestStripQuotedRecognisesAJapaneseAttribution(t *testing.T) {
	text := "直りました。\n\n2026年10月5日(月) 18:30 Example <contact@reply.example.com>：\n> もう一度お試しください。"
	if got := StripQuoted(text); got != "直りました。" {
		t.Fatalf("StripQuoted = %q", got)
	}
	outlook := "直りました。\n\n________________________________\n差出人: Example <contact@reply.example.com>\n送信日時: 2026年10月5日 18:30"
	if got := StripQuoted(outlook); got != "直りました。" {
		t.Fatalf("StripQuoted = %q", got)
	}
}
