# Soulseek integration plan

Goal: let Grapefruit fill the gaps it already finds. The Streaming Gap report
knows exactly which tracks you're missing from your local library. Soulseek is
where those tracks actually live. This connects the two: search Soulseek for a
missing track, download the best copy, and drop it into your hub.

## Why slskd, not SoulseekQT

SoulseekQT is a desktop GUI with no automation surface. Driving it would mean
screen-scraping a Qt window, which is brittle and unshippable.

The integration-friendly path is **slskd** (https://github.com/slskd/slskd): a
headless Soulseek daemon with a documented REST + WebSocket API and API-key
auth. It runs as a separate process (Docker image or a single binary), logs in
to the Soulseek network with the user's own credentials, and exposes search,
browse, and transfer endpoints. Grapefruit talks to it over HTTP the same way it
talks to Plex.

(A pure-Python option, `aioslsk`, would let us speak the Soulseek protocol
in-process and avoid a second daemon, but it reimplements more of the network
stack and is less battle-tested. Start with slskd; keep aioslsk as a fallback if
the separate-daemon requirement proves too heavy for users.)

The user must run and configure slskd themselves (their Soulseek account, their
machine). Grapefruit is a client to it, not a bundler of it.

## Architecture

**Backend**
- `python/core/soulseek_client.py` — wraps the slskd REST API:
  - `search(query)` → start a search, poll until responses settle, return
    candidates `{username, filename, size, bitrate, extension, length, slots}`.
  - `download(username, files)` → enqueue transfers.
  - `downloads()` → active/finished transfer state for progress.
  - `cancel(id)`, `test_connection()`.
- Config lives in `app_config` (like Plex): `slskd_url`, `slskd_api_key`,
  `soulseek_download_dir` (defaults to a `_incoming` folder under the hub).
- New RPCs in `rpc_handler.py`: `soulseek_status`, `soulseek_search`,
  `soulseek_download`, `soulseek_downloads`, `soulseek_cancel`. Progress rides
  the existing `_notify("progress", {op: "soulseek_download", ...})` channel.
- Reuse `normalize_for_matching` + the matcher's scoring to rank candidates
  against the target `artist + title`; prefer lossless, then high-bitrate MP3;
  drop tiny/mismatched files; de-prioritize users with no free upload slots.

**Frontend**
- Settings: a Soulseek card (slskd URL, API key, Test connection), mirroring the
  Plex card.
- Streaming Gap: each `missing` row gets a "Find on Soulseek" action → a result
  picker (candidate list with user, quality, size, availability) → pick → enqueue.
  Plus a batch "Find all missing" that auto-selects the best candidate per track
  with a review step before downloading.
- A Downloads panel (reuse `useProgress`) showing active transfers; on
  completion, move the file into the hub, optionally run auto-organize, and
  rescan so it shows up in the Library immediately.

## Matching / quality heuristics
- Normalize artist+title (existing util); require both to match.
- Rank: `flac`/`alac` > `mp3 @ >=320` > `mp3 @ >=256` > everything else.
- Reject files whose size is implausible for the track length.
- Prefer candidates from users with free upload slots (faster, fewer stalls).
- Dedupe identical filenames across users; keep the top few per track.

## Legal / ethical framing
Soulseek shares user-to-user files, much of it copyrighted. This feature only
initiates searches and transfers the user explicitly chooses, using the user's
own Soulseek account — the same thing the Soulseek client does. Keep it strictly
opt-in (off until slskd is configured), never auto-download without a review
step, and make clear in the UI that the user is responsible for what they pull.

## Phasing
1. **Pipe proof** — slskd connection + config + `Test connection`, a bare search
   box that lists results and downloads one file to a folder. Validates the API
   and auth end to end.
2. **Gap wiring** — per-track "Find on Soulseek" from the Streaming Gap missing
   list, quality ranking, and a Downloads panel with live progress.
3. **Bulk + import** — "grab all missing" with best-candidate auto-select and a
   review step, then auto-import into the hub (organize + rescan).

## Open questions / risks
- Setup burden: users must install and run slskd and log in with a Soulseek
  account. This is the biggest adoption cost; the Settings card should link to
  slskd's setup docs and detect when it isn't reachable.
- Availability and speed are outside our control (queues, offline users, stalls);
  the UI must treat downloads as best-effort with retries and clear failure.
- slskd API stability across versions — pin a tested version range.
- Search result volume can be large and slow to settle; cap and time-box polling.

## Dependencies to start
- A running slskd instance and its API key (user-provided).
- Confirm slskd's current REST endpoints/version to target.
