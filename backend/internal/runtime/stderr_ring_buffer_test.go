package runtime

import (
	"errors"
	"strings"
	"testing"
)

func TestStderrRingBufferRetainsNewestLines(t *testing.T) {
	t.Parallel()

	buffer := newStderrRingBuffer(3)
	buffer.Append("first")
	buffer.Append("second")
	buffer.Append("third")
	buffer.Append("fourth")

	got := buffer.Snapshot()
	want := []string{"second", "third", "fourth"}
	if len(got) != len(want) {
		t.Fatalf("expected %d lines, got %#v", len(want), got)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("expected snapshot %#v, got %#v", want, got)
		}
	}
}

func TestSummarizeRuntimeFailureIncludesStderrTail(t *testing.T) {
	t.Parallel()

	summary := summarizeRuntimeFailure(errors.New("start app-server: exit status 23"), []string{
		"boot line one",
		"boot line two",
		"fatal: runtime exited unexpectedly",
	})

	if !strings.Contains(summary, "start app-server: exit status 23") {
		t.Fatalf("expected summary to contain primary error, got %q", summary)
	}
	if !strings.Contains(summary, "fatal: runtime exited unexpectedly") {
		t.Fatalf("expected summary to contain stderr tail, got %q", summary)
	}
}
