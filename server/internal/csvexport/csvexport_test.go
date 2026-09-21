package csvexport

import "testing"

func TestWriterEncodesForSpreadsheets(t *testing.T) {
	w := New("title", "amount")
	w.Row(`Tea, "Green" and Black`, "500")
	w.Row("緑茶の本", "1200")
	got, err := w.Bytes()
	if err != nil {
		t.Fatalf("Bytes: %v", err)
	}
	want := "\xEF\xBB\xBF" +
		"title,amount\r\n" +
		`"Tea, ""Green"" and Black",500` + "\r\n" +
		"緑茶の本,1200\r\n"
	if string(got) != want {
		t.Fatalf("csv = %q, want %q", got, want)
	}
}

func TestWriterWithOnlyAHeader(t *testing.T) {
	got, err := New("title").Bytes()
	if err != nil {
		t.Fatalf("Bytes: %v", err)
	}
	if string(got) != "\xEF\xBB\xBFtitle\r\n" {
		t.Fatalf("csv = %q, want the BOM and the header row", got)
	}
}

func TestWriterNeutralizesFormulas(t *testing.T) {
	w := New("value")
	for _, field := range []string{"=SUM(A1:A2)", "+cmd", "-2+3", "@A1", "\tTab", "-12.5", "+3", "Plain"} {
		w.Row(field)
	}
	got, err := w.Bytes()
	if err != nil {
		t.Fatalf("Bytes: %v", err)
	}
	want := "\xEF\xBB\xBFvalue\r\n" +
		"'=SUM(A1:A2)\r\n'+cmd\r\n'-2+3\r\n'@A1\r\n'\tTab\r\n-12.5\r\n+3\r\nPlain\r\n"
	if string(got) != want {
		t.Fatalf("csv = %q, want %q", got, want)
	}
}
