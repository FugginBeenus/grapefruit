from rapidfuzz import fuzz, process

from core.models import (
    PlaylistTrack, LocalTrack, MatchResult,
    MatchCandidate, MatchStatus,
)
from core.utils import normalize_for_matching

AUTO_MATCH_THRESHOLD = 90
UNCERTAIN_THRESHOLD = 70
MAX_CANDIDATES = 5


class Matcher:
    """Fuzzy matches playlist tracks against local music files."""

    def __init__(
        self,
        local_tracks: list[LocalTrack],
        auto_threshold: int = AUTO_MATCH_THRESHOLD,
        uncertain_threshold: int = UNCERTAIN_THRESHOLD,
    ):
        self._local_tracks = local_tracks
        self._auto_threshold = auto_threshold
        self._uncertain_threshold = uncertain_threshold
        self._artist_index: dict[str, list[LocalTrack]] = {}
        self._build_index()

    def _build_index(self):
        """Build lookup index by normalized artist for fast candidate search."""
        for track in self._local_tracks:
            key = track.normalized_artist
            if key:
                if key not in self._artist_index:
                    self._artist_index[key] = []
                self._artist_index[key].append(track)

    def match_all(self, playlist_tracks: list[PlaylistTrack], progress_callback=None) -> list[MatchResult]:
        """Match every playlist track against the local library."""
        results = []
        total = len(playlist_tracks)

        for i, pt in enumerate(playlist_tracks):
            result = self.match_single(pt)
            results.append(result)
            if progress_callback:
                progress_callback(i + 1, total)

        return results

    def match_single(self, playlist_track: PlaylistTrack) -> MatchResult:
        """Match a single playlist track against the library."""
        candidates = self._find_and_score_candidates(playlist_track)

        # Sort by score descending
        candidates.sort(key=lambda c: c.score, reverse=True)
        candidates = candidates[:MAX_CANDIDATES]

        if not candidates:
            return MatchResult(
                playlist_track=playlist_track,
                status=MatchStatus.MISSING,
                candidates=[],
            )

        best = candidates[0]

        if best.score >= self._auto_threshold:
            status = MatchStatus.MATCHED
        elif best.score >= self._uncertain_threshold:
            status = MatchStatus.UNCERTAIN
        else:
            status = MatchStatus.MISSING

        return MatchResult(
            playlist_track=playlist_track,
            status=status,
            best_match=best if status != MatchStatus.MISSING else None,
            candidates=candidates,
        )

    def _find_and_score_candidates(self, playlist_track: PlaylistTrack) -> list[MatchCandidate]:
        """Find and score candidate matches."""
        norm_artist = normalize_for_matching(playlist_track.artist)
        norm_title = normalize_for_matching(playlist_track.title)
        norm_album = normalize_for_matching(playlist_track.album)

        # Strategy 1: find candidates by artist index
        candidates_pool = set()

        # Exact artist key lookup
        if norm_artist in self._artist_index:
            for t in self._artist_index[norm_artist]:
                candidates_pool.add(id(t))

        # Fuzzy artist key lookup - find similar artist keys
        if len(candidates_pool) < 5:
            for artist_key, tracks in self._artist_index.items():
                if artist_key and fuzz.token_sort_ratio(norm_artist, artist_key) >= 60:
                    for t in tracks:
                        candidates_pool.add(id(t))

        # Build id->track lookup
        id_to_track = {id(t): t for t in self._local_tracks}

        # If still few candidates, search by title across all tracks
        if len(candidates_pool) < 3:
            query = f"{norm_artist} {norm_title}".strip()
            search_strings = {
                id(t): f"{t.normalized_artist} {t.normalized_title}"
                for t in self._local_tracks
            }
            if search_strings:
                results = process.extract(
                    query,
                    search_strings,
                    scorer=fuzz.token_sort_ratio,
                    limit=10,
                    score_cutoff=50,
                )
                for _, score, key in results:
                    candidates_pool.add(key)

        # Score each candidate
        scored = []
        for track_id in candidates_pool:
            track = id_to_track.get(track_id)
            if track is None:
                continue
            score = self._compute_score(playlist_track, track, norm_artist, norm_title, norm_album)
            matched_on = "artist+title"
            scored.append(MatchCandidate(
                local_track=track,
                score=score,
                matched_on=matched_on,
            ))

        return scored

    def _compute_score(
        self,
        playlist_track: PlaylistTrack,
        local_track: LocalTrack,
        norm_pt_artist: str,
        norm_pt_title: str,
        norm_pt_album: str,
    ) -> float:
        """Compute similarity score between playlist track and local track."""
        artist_score = fuzz.token_sort_ratio(norm_pt_artist, local_track.normalized_artist)
        title_score = fuzz.token_sort_ratio(norm_pt_title, local_track.normalized_title)

        combined = (artist_score * 0.4) + (title_score * 0.6)

        # Album bonus
        if norm_pt_album and local_track.album:
            norm_local_album = normalize_for_matching(local_track.album)
            album_score = fuzz.token_sort_ratio(norm_pt_album, norm_local_album)
            if album_score >= 80:
                combined = min(100, combined + 5)

        # Duration bonus
        pt_dur = playlist_track.duration_seconds
        lt_dur = local_track.duration_seconds
        if pt_dur and lt_dur:
            if abs(pt_dur - lt_dur) < 3:
                combined = min(100, combined + 3)

        return round(combined, 1)
