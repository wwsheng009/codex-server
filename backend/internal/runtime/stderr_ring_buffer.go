package runtime

import "strings"

const (
	runtimeStderrRingBufferCapacity = 64
	runtimeStderrSummaryLineLimit   = 4
	runtimeStderrLineMaxChars       = 512
	runtimeStderrSummaryMaxChars    = 600
)

type stderrRingBuffer struct {
	lines []string
	next  int
	full  bool
}

func newStderrRingBuffer(capacity int) *stderrRingBuffer {
	if capacity <= 0 {
		capacity = 1
	}
	return &stderrRingBuffer{
		lines: make([]string, capacity),
	}
}

func (b *stderrRingBuffer) Reset() {
	for index := range b.lines {
		b.lines[index] = ""
	}
	b.next = 0
	b.full = false
}

func (b *stderrRingBuffer) Append(line string) {
	if len(b.lines) == 0 {
		return
	}

	line = strings.TrimSpace(line)
	if line == "" {
		return
	}

	b.lines[b.next] = truncateRuntimeStderrText(line, runtimeStderrLineMaxChars)
	b.next++
	if b.next >= len(b.lines) {
		b.next = 0
		b.full = true
	}
}

func (b *stderrRingBuffer) Snapshot() []string {
	if len(b.lines) == 0 {
		return nil
	}

	if !b.full {
		snapshot := make([]string, 0, b.next)
		for _, line := range b.lines[:b.next] {
			if strings.TrimSpace(line) != "" {
				snapshot = append(snapshot, line)
			}
		}
		return snapshot
	}

	snapshot := make([]string, 0, len(b.lines))
	for offset := 0; offset < len(b.lines); offset++ {
		index := (b.next + offset) % len(b.lines)
		line := b.lines[index]
		if strings.TrimSpace(line) != "" {
			snapshot = append(snapshot, line)
		}
	}
	return snapshot
}

func summarizeRuntimeStderr(lines []string) string {
	if len(lines) == 0 {
		return ""
	}

	start := 0
	if len(lines) > runtimeStderrSummaryLineLimit {
		start = len(lines) - runtimeStderrSummaryLineLimit
	}

	parts := make([]string, 0, len(lines)-start)
	for _, line := range lines[start:] {
		line = strings.TrimSpace(line)
		if line != "" {
			parts = append(parts, line)
		}
	}
	if len(parts) == 0 {
		return ""
	}

	return truncateRuntimeStderrText(strings.Join(parts, " | "), runtimeStderrSummaryMaxChars)
}

func truncateRuntimeStderrText(value string, limit int) string {
	value = strings.TrimSpace(value)
	if limit <= 0 || len(value) <= limit {
		return value
	}
	if limit <= 3 {
		return value[:limit]
	}
	return value[:limit-3] + "..."
}
