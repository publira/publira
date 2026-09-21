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
