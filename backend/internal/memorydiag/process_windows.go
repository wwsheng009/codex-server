//go:build windows

package memorydiag

import (
	"errors"
	"fmt"
	"syscall"
	"unsafe"
)

type processMemorySnapshot struct {
	WorkingSetBytes     uint64
	PrivateBytes        uint64
	PagefileBytes       uint64
	PeakWorkingSetBytes uint64
	PeakPrivateBytes    uint64
}

type processMemoryCountersEx struct {
	cb                         uint32
	pageFaultCount             uint32
	peakWorkingSetSize         uintptr
	workingSetSize             uintptr
	quotaPeakPagedPoolUsage    uintptr
	quotaPagedPoolUsage        uintptr
	quotaPeakNonPagedPoolUsage uintptr
	quotaNonPagedPoolUsage     uintptr
	pagefileUsage              uintptr
	peakPagefileUsage          uintptr
	privateUsage               uintptr
}

var (
	kernel32Module           = syscall.NewLazyDLL("kernel32.dll")
	psapiModule              = syscall.NewLazyDLL("psapi.dll")
	openProcessProc          = kernel32Module.NewProc("OpenProcess")
	closeHandleProc          = kernel32Module.NewProc("CloseHandle")
	getProcessMemoryInfoProc = psapiModule.NewProc("GetProcessMemoryInfo")
)

const (
	processQueryInformation = 0x0400
	processVMRead           = 0x0010
)

func readProcessMemorySnapshot(pid int) (processMemorySnapshot, error) {
	if pid <= 0 {
		return processMemorySnapshot{}, errors.New("invalid pid")
	}

	handle, _, openErr := openProcessProc.Call(
		uintptr(processQueryInformation|processVMRead),
		0,
		uintptr(uint32(pid)),
	)
	if handle == 0 {
		if openErr != syscall.Errno(0) {
			return processMemorySnapshot{}, fmt.Errorf("OpenProcess failed: %w", openErr)
		}
		return processMemorySnapshot{}, errors.New("OpenProcess failed")
	}
	defer closeHandleProc.Call(handle)

	counters := processMemoryCountersEx{
		cb: uint32(unsafe.Sizeof(processMemoryCountersEx{})),
	}
	result, _, memoryErr := getProcessMemoryInfoProc.Call(
		handle,
		uintptr(unsafe.Pointer(&counters)),
		uintptr(counters.cb),
	)
	if result == 0 {
		if memoryErr != syscall.Errno(0) {
			return processMemorySnapshot{}, fmt.Errorf("GetProcessMemoryInfo failed: %w", memoryErr)
		}
		return processMemorySnapshot{}, errors.New("GetProcessMemoryInfo failed")
	}

	return processMemorySnapshot{
		WorkingSetBytes:     uint64(counters.workingSetSize),
		PrivateBytes:        uint64(counters.privateUsage),
		PagefileBytes:       uint64(counters.pagefileUsage),
		PeakWorkingSetBytes: uint64(counters.peakWorkingSetSize),
		PeakPrivateBytes:    uint64(counters.peakPagefileUsage),
	}, nil
}
