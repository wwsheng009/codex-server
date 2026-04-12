package memorydiag

import (
	"fmt"
	"os"
	"runtime"
	"runtime/debug"
	"time"

	"codex-server/backend/internal/store"
)

type Service struct {
	store      *store.MemoryStore
	pid        int
	executable string
	startedAt  time.Time
}

type CaptureOptions struct {
	TopN    int
	ForceGC bool
}

type Snapshot struct {
	CapturedAt time.Time              `json:"capturedAt"`
	ForceGC    bool                   `json:"forceGc"`
	Process    ProcessSnapshot        `json:"process"`
	Runtime    RuntimeSnapshot        `json:"runtime"`
	Store      store.MemoryInspection `json:"store"`
	Findings   []string               `json:"findings"`
}

type ProcessSnapshot struct {
	PID                 int       `json:"pid"`
	Executable          string    `json:"executable"`
	GOOS                string    `json:"goos"`
	GOARCH              string    `json:"goarch"`
	StartedAt           time.Time `json:"startedAt"`
	WorkingSetBytes     uint64    `json:"workingSetBytes,omitempty"`
	PrivateBytes        uint64    `json:"privateBytes,omitempty"`
	PagefileBytes       uint64    `json:"pagefileBytes,omitempty"`
	PeakWorkingSetBytes uint64    `json:"peakWorkingSetBytes,omitempty"`
	PeakPrivateBytes    uint64    `json:"peakPrivateBytes,omitempty"`
	SampleError         string    `json:"sampleError,omitempty"`
}

type RuntimeSnapshot struct {
	Goroutines        int        `json:"goroutines"`
	CgoCalls          int64      `json:"cgoCalls"`
	CPUCount          int        `json:"cpuCount"`
	GOMAXPROCS        int        `json:"gomaxprocs"`
	AllocBytes        uint64     `json:"allocBytes"`
	TotalAllocBytes   uint64     `json:"totalAllocBytes"`
	SysBytes          uint64     `json:"sysBytes"`
	Mallocs           uint64     `json:"mallocs"`
	Frees             uint64     `json:"frees"`
	HeapAllocBytes    uint64     `json:"heapAllocBytes"`
	HeapSysBytes      uint64     `json:"heapSysBytes"`
	HeapIdleBytes     uint64     `json:"heapIdleBytes"`
	HeapInuseBytes    uint64     `json:"heapInuseBytes"`
	HeapReleasedBytes uint64     `json:"heapReleasedBytes"`
	HeapObjects       uint64     `json:"heapObjects"`
	StackInuseBytes   uint64     `json:"stackInuseBytes"`
	StackSysBytes     uint64     `json:"stackSysBytes"`
	MSpanInuseBytes   uint64     `json:"mspanInuseBytes"`
	MSpanSysBytes     uint64     `json:"mspanSysBytes"`
	MCacheInuseBytes  uint64     `json:"mcacheInuseBytes"`
	MCacheSysBytes    uint64     `json:"mcacheSysBytes"`
	BuckHashSysBytes  uint64     `json:"buckHashSysBytes"`
	GCSysBytes        uint64     `json:"gcSysBytes"`
	OtherSysBytes     uint64     `json:"otherSysBytes"`
	NextGCBytes       uint64     `json:"nextGcBytes"`
	LastGC            *time.Time `json:"lastGc,omitempty"`
	PauseTotalNs      uint64     `json:"pauseTotalNs"`
	NumGC             uint32     `json:"numGc"`
	NumForcedGC       uint32     `json:"numForcedGc"`
	GCCPUFraction     float64    `json:"gcCpuFraction"`
}

func NewService(dataStore *store.MemoryStore) *Service {
	executable, err := os.Executable()
	if err != nil {
		executable = ""
	}

	return &Service{
		store:      dataStore,
		pid:        os.Getpid(),
		executable: executable,
		startedAt:  time.Now().UTC(),
	}
}

func (s *Service) Capture(options CaptureOptions) Snapshot {
	topN := options.TopN
	if topN <= 0 {
		topN = 10
	}

	if options.ForceGC {
		runtime.GC()
		debug.FreeOSMemory()
	}

	capturedAt := time.Now().UTC()
	memStats := runtime.MemStats{}
	runtime.ReadMemStats(&memStats)

	processSnapshot := ProcessSnapshot{
		PID:        s.pid,
		Executable: s.executable,
		GOOS:       runtime.GOOS,
		GOARCH:     runtime.GOARCH,
		StartedAt:  s.startedAt,
	}
	if info, err := readProcessMemorySnapshot(s.pid); err == nil {
		processSnapshot.WorkingSetBytes = info.WorkingSetBytes
		processSnapshot.PrivateBytes = info.PrivateBytes
		processSnapshot.PagefileBytes = info.PagefileBytes
		processSnapshot.PeakWorkingSetBytes = info.PeakWorkingSetBytes
		processSnapshot.PeakPrivateBytes = info.PeakPrivateBytes
	} else if err != nil {
		processSnapshot.SampleError = err.Error()
	}

	var lastGC *time.Time
	if memStats.LastGC > 0 {
		ts := time.Unix(0, int64(memStats.LastGC)).UTC()
		lastGC = &ts
	}

	storeInspection := store.MemoryInspection{}
	if s != nil && s.store != nil {
		storeInspection = s.store.InspectMemory(topN)
	}

	snapshot := Snapshot{
		CapturedAt: capturedAt,
		ForceGC:    options.ForceGC,
		Process:    processSnapshot,
		Runtime: RuntimeSnapshot{
			Goroutines:        runtime.NumGoroutine(),
			CgoCalls:          runtime.NumCgoCall(),
			CPUCount:          runtime.NumCPU(),
			GOMAXPROCS:        runtime.GOMAXPROCS(0),
			AllocBytes:        memStats.Alloc,
			TotalAllocBytes:   memStats.TotalAlloc,
			SysBytes:          memStats.Sys,
			Mallocs:           memStats.Mallocs,
			Frees:             memStats.Frees,
			HeapAllocBytes:    memStats.HeapAlloc,
			HeapSysBytes:      memStats.HeapSys,
			HeapIdleBytes:     memStats.HeapIdle,
			HeapInuseBytes:    memStats.HeapInuse,
			HeapReleasedBytes: memStats.HeapReleased,
			HeapObjects:       memStats.HeapObjects,
			StackInuseBytes:   memStats.StackInuse,
			StackSysBytes:     memStats.StackSys,
			MSpanInuseBytes:   memStats.MSpanInuse,
			MSpanSysBytes:     memStats.MSpanSys,
			MCacheInuseBytes:  memStats.MCacheInuse,
			MCacheSysBytes:    memStats.MCacheSys,
			BuckHashSysBytes:  memStats.BuckHashSys,
			GCSysBytes:        memStats.GCSys,
			OtherSysBytes:     memStats.OtherSys,
			NextGCBytes:       memStats.NextGC,
			LastGC:            lastGC,
			PauseTotalNs:      memStats.PauseTotalNs,
			NumGC:             memStats.NumGC,
			NumForcedGC:       memStats.NumForcedGC,
			GCCPUFraction:     memStats.GCCPUFraction,
		},
		Store: storeInspection,
	}
	snapshot.Findings = buildFindings(snapshot)
	return snapshot
}

func buildFindings(snapshot Snapshot) []string {
	findings := make([]string, 0, 6)

	if snapshot.Store.SerializedBytes.Total > 0 && snapshot.Store.SerializedBytes.ThreadProjections > 0 {
		share := percent(snapshot.Store.SerializedBytes.ThreadProjections, snapshot.Store.SerializedBytes.Total)
		findings = append(
			findings,
			fmt.Sprintf(
				"thread projections serialize to %s, about %.1f%% of tracked store data",
				formatBytes(snapshot.Store.SerializedBytes.ThreadProjections),
				share,
			),
		)
	}

	if snapshot.Store.Threads.ResidentCompressedBytes > 0 {
		findings = append(
			findings,
			fmt.Sprintf(
				"cold thread projection turns occupy %s resident bytes in compressed form across %d projections",
				formatBytes(snapshot.Store.Threads.ResidentCompressedBytes),
				snapshot.Store.Threads.ColdProjectionCount,
			),
		)
	}

	if snapshot.Store.Threads.ExternalizedProjectionCount > 0 {
		findings = append(
			findings,
			fmt.Sprintf(
				"%d thread projections are externalized to sidecar files, so their turn payloads do not stay resident in the main store heap",
				snapshot.Store.Threads.ExternalizedProjectionCount,
			),
		)
	}

	if len(snapshot.Store.Threads.ItemTypes) > 0 {
		top := snapshot.Store.Threads.ItemTypes[0]
		findings = append(
			findings,
			fmt.Sprintf(
				"%s items inside thread projections account for %s across %d items",
				top.Type,
				formatBytes(top.TotalBytes),
				top.Count,
			),
		)
	}

	if len(snapshot.Store.Threads.Largest) > 0 {
		largest := snapshot.Store.Threads.Largest[0]
		findings = append(
			findings,
			fmt.Sprintf(
				"largest projected thread is %s/%s at %s (%d turns, %d items)",
				largest.WorkspaceID,
				largest.ThreadID,
				formatBytes(largest.JSONBytes),
				largest.TurnCount,
				largest.ItemCount,
			),
		)
	}

	if snapshot.Process.WorkingSetBytes > 0 && snapshot.Runtime.HeapInuseBytes > 0 {
		findings = append(
			findings,
			fmt.Sprintf(
				"process working set is %s while Go heap in-use is %s; the gap includes runtime metadata, stacks, retained pages and OS accounting",
				formatBytes(int64(snapshot.Process.WorkingSetBytes)),
				formatBytes(int64(snapshot.Runtime.HeapInuseBytes)),
			),
		)
	}

	if snapshot.ForceGC {
		findings = append(findings, "sample was captured after forcing Go GC and releasing free heap pages back to the OS")
	}

	return findings
}

func percent(part int64, total int64) float64 {
	if total <= 0 {
		return 0
	}
	return (float64(part) / float64(total)) * 100
}

func formatBytes(value int64) string {
	if value < 0 {
		value = 0
	}
	const unit = 1024
	if value < unit {
		return fmt.Sprintf("%d B", value)
	}

	div, exp := int64(unit), 0
	for n := value / unit; n >= unit; n /= unit {
		div *= unit
		exp += 1
	}

	suffixes := []string{"KiB", "MiB", "GiB", "TiB"}
	if exp >= len(suffixes) {
		exp = len(suffixes) - 1
	}
	return fmt.Sprintf("%.1f %s", float64(value)/float64(div), suffixes[exp])
}
