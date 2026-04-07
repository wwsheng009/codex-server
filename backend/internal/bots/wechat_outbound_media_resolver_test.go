package bots

import "testing"

func TestExpandWeChatRemoteMediaCandidateURLsRewritesDailymotionEmbed(t *testing.T) {
	t.Parallel()

	candidates := expandWeChatRemoteMediaCandidateURLs(
		"https://www.euronews.com/video/2026/03/12/watch-strait-of-hormuz-iran-and-naval-mines-an-explosive-mix",
		"https://geo.dailymotion.com/player/xfake.html?video=xa1rcfk",
	)

	if len(candidates) != 2 {
		t.Fatalf("expected original embed url plus canonical dailymotion video url, got %#v", candidates)
	}
	if got := candidates[0]; got != "https://geo.dailymotion.com/player/xfake.html?video=xa1rcfk" {
		t.Fatalf("expected first candidate to preserve the original embed url, got %q", got)
	}
	if got := candidates[1]; got != "https://www.dailymotion.com/video/xa1rcfk" {
		t.Fatalf("expected second candidate to canonicalize the dailymotion video url, got %q", got)
	}
}

func TestWeChatRemoteMediaURLRecognitionIgnoresQueryString(t *testing.T) {
	t.Parallel()

	if !looksLikeDirectVideoFileURL("https://cdn.example.test/video.mp4?download=1#fragment") {
		t.Fatal("expected direct video file detection to ignore query string and fragment")
	}
	if !looksLikeStreamingPlaylistURL("https://cdn.example.test/live/playlist.m3u8?token=abc123") {
		t.Fatal("expected streaming playlist detection to ignore query string")
	}
	if !looksLikeDirectImageFileURL("https://cdn.example.test/image.webp?width=1024") {
		t.Fatal("expected direct image file detection to ignore query string")
	}
}
