package store

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

const threadProjectionCommandOutputMaxBytes = 4 * 1024

type projectedCommandOutputWindow struct {
	output      string
	startOffset int
	endOffset   int
	totalLength int
	startLine   int
	endLine     int
	totalLines  int
	truncated   bool
}

func compactProjectedThreadTurns(turns []ThreadTurn) []ThreadTurn {
	if len(turns) == 0 {
		return []ThreadTurn{}
	}

	compacted := make([]ThreadTurn, 0, len(turns))
	for _, turn := range turns {
		nextTurn := ThreadTurn{
			ID:     turn.ID,
			Status: turn.Status,
			Error:  turn.Error,
		}
		if len(turn.Items) == 0 {
			nextTurn.Items = []map[string]any{}
			compacted = append(compacted, nextTurn)
			continue
		}

		nextTurn.Items = make([]map[string]any, 0, len(turn.Items))
		for _, item := range turn.Items {
			nextTurn.Items = append(nextTurn.Items, compactProjectedItem(item))
		}
		compacted = append(compacted, nextTurn)
	}

	return compacted
}

func compactProjectedItem(item map[string]any) map[string]any {
	next := cloneItem(item)
	if stringValue(next["type"]) != "commandExecution" {
		return next
	}

	return compactProjectedCommandExecutionItem(next)
}

func compactProjectedCommandExecutionItem(item map[string]any) map[string]any {
	next := cloneItem(item)
	output := stringValue(next["aggregatedOutput"])
	if output == "" {
		clearProjectedCommandExecutionOutputMetadata(next)
		return next
	}

	window := buildProjectedCommandOutputWindow(
		output,
		maxProjectedOutputInt(intValue(next["outputTotalLength"]), len(output)),
		maxProjectedOutputInt(intValue(next["outputLineCount"]), countProjectedOutputLines(output)),
	)
	applyProjectedCommandExecutionOutputWindow(next, window)
	return next
}

func appendProjectedCommandExecutionOutput(item map[string]any, delta string) map[string]any {
	next := cloneItem(item)
	currentOutput := stringValue(next["aggregatedOutput"])
	previousTotalLength := intValue(next["outputTotalLength"])
	if previousTotalLength < len(currentOutput) {
		previousTotalLength = len(currentOutput)
	}

	previousTotalLines := intValue(next["outputLineCount"])
	if previousTotalLines < countProjectedOutputLines(currentOutput) {
		previousTotalLines = countProjectedOutputLines(currentOutput)
	}

	combinedOutput := currentOutput + delta
	totalLength := previousTotalLength + len(delta)
	totalLines := projectedOutputLineCountAfterAppend(previousTotalLines, currentOutput, delta)
	window := buildProjectedCommandOutputWindow(combinedOutput, totalLength, totalLines)
	applyProjectedCommandExecutionOutputWindow(next, window)
	return next
}

func buildProjectedCommandOutputWindow(
	output string,
	totalLength int,
	totalLines int,
) projectedCommandOutputWindow {
	if totalLength < len(output) {
		totalLength = len(output)
	}
	if totalLines < countProjectedOutputLines(output) {
		totalLines = countProjectedOutputLines(output)
	}

	retainedOutput := retainProjectedOutputTail(output, threadProjectionCommandOutputMaxBytes)
	startOffset := totalLength - len(retainedOutput)
	if startOffset < 0 {
		startOffset = 0
	}

	retainedLineCount := countProjectedOutputLines(retainedOutput)
	startLine := totalLines - retainedLineCount
	if startLine < 0 {
		startLine = 0
	}

	endOffset := totalLength - projectedOutputTrailingLineBreakSuffixLength(retainedOutput)
	if endOffset < startOffset {
		endOffset = startOffset
	}

	return projectedCommandOutputWindow{
		output:      retainedOutput,
		startOffset: startOffset,
		endOffset:   endOffset,
		totalLength: totalLength,
		startLine:   startLine,
		endLine:     totalLines,
		totalLines:  totalLines,
		truncated:   startOffset > 0,
	}
}

func applyProjectedCommandExecutionOutputWindow(item map[string]any, window projectedCommandOutputWindow) {
	item["aggregatedOutput"] = window.output
	if window.truncated {
		item["outputContentMode"] = "tail"
		item["outputTruncated"] = true
		item["outputStartOffset"] = window.startOffset
		item["outputEndOffset"] = window.endOffset
		item["outputTotalLength"] = window.totalLength
		item["outputStartLine"] = window.startLine
		item["outputEndLine"] = window.endLine
		item["outputLineCount"] = window.totalLines
		return
	}

	clearProjectedCommandExecutionOutputMetadata(item)
}

func clearProjectedCommandExecutionOutputMetadata(item map[string]any) {
	delete(item, "outputContentMode")
	delete(item, "outputTruncated")
	delete(item, "outputStartOffset")
	delete(item, "outputEndOffset")
	delete(item, "outputTotalLength")
	delete(item, "outputStartLine")
	delete(item, "outputEndLine")
	delete(item, "outputLineCount")
}

func retainProjectedOutputTail(value string, maxBytes int) string {
	if maxBytes <= 0 || len(value) <= maxBytes {
		return value
	}

	start := len(value) - maxBytes
	for start < len(value) && !utf8.ValidString(value[start:]) {
		start += 1
	}
	if start >= len(value) {
		return value[len(value)-maxBytes:]
	}
	return value[start:]
}

func projectedOutputLineCountAfterAppend(previousTotalLines int, previousOutput string, delta string) int {
	if delta == "" {
		if previousTotalLines > 0 {
			return previousTotalLines
		}
		return countProjectedOutputLines(previousOutput)
	}

	deltaLines := countProjectedOutputLines(delta)
	if previousTotalLines <= 0 {
		return countProjectedOutputLines(previousOutput + delta)
	}
	if deltaLines == 0 {
		return previousTotalLines
	}
	if projectedOutputEndsWithLineBreak(previousOutput) {
		return previousTotalLines + deltaLines
	}
	if previousTotalLines == 0 {
		return deltaLines
	}

	return previousTotalLines + deltaLines - 1
}

func projectedOutputEndsWithLineBreak(value string) bool {
	return strings.HasSuffix(value, "\n") || strings.HasSuffix(value, "\r")
}

func projectedOutputTrailingLineBreakSuffixLength(value string) int {
	end := len(value)
	for end > 0 {
		switch value[end-1] {
		case '\n', '\r':
			end -= 1
		default:
			return len(value) - end
		}
	}
	return len(value)
}

func countProjectedOutputLines(value string) int {
	normalized := strings.ReplaceAll(value, "\r\n", "\n")
	trimmed := strings.TrimRightFunc(normalized, unicode.IsSpace)
	if trimmed == "" {
		return 0
	}

	return strings.Count(trimmed, "\n") + 1
}

func maxProjectedOutputInt(left int, right int) int {
	if left > right {
		return left
	}
	return right
}
