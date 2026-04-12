//go:build !windows

package memorydiag

import "errors"

type processMemorySnapshot struct {
	WorkingSetBytes     uint64
	PrivateBytes        uint64
	PagefileBytes       uint64
	PeakWorkingSetBytes uint64
	PeakPrivateBytes    uint64
}

func readProcessMemorySnapshot(pid int) (processMemorySnapshot, error) {
	if pid <= 0 {
		return processMemorySnapshot{}, errors.New("invalid pid")
	}
	return processMemorySnapshot{}, errors.New("process memory sampling is only implemented on windows")
}
