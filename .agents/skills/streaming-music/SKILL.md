---
name: streaming-music
description: Verified facts, OAuth/SDK recipes, token boundaries and limits for YouTube / YouTube Music (IFrame Player API), Spotify (Web API + Web Playback SDK, OAuth 2.0 PKCE), and Apple Music (MusicKit JS v3) in Voxelwright's car radio (engine/page/sound/radio-providers.ts, engine/page/sound/radio.ts, engine/page/radio-ui.ts). Load before changing external music streaming, OAuth flows, playlist fetching, or embed previews.
---

# Streaming Music Providers (YouTube Music, Spotify & Apple Music)

Version 2, November 26, 2026. Scope: `engine/page/sound/radio-providers.ts`, `engine/page/sound/radio.ts`, `engine/page/radio-ui.ts`, and `engine/test/radio-providers.mjs`.

**Active providers (`ENABLED_STREAMING_PROVIDERS`)**:
- **YouTube Music**: **enabled by default** (zero API key, zero login, works immediately for any visitor).
- **Spotify & Apple Music**: **disabled in the UI by default** until developer accounts are configured (kept intact in code; toggle `ENABLED_STREAMING_PROVIDERS` or pass `?radio_providers=all` to enable).

Grounded from current primary vendor documentation on November 26, 2026. **No live YouTube, Spotify Premium, or Apple Music streaming has been executed in automated CI** (see Limits); automated checks exercise mocked SDK/API adapters and unit-test URL parsing, PKCE, MusicKit, saved playlists, ducking, ToS viewport sizing, and UI lifecycle.

## YouTube / YouTube Music (IFrame Player API — active by default)

- **No dedicated YouTube Music SDK**: Google provides no official YouTube Music Web Playback SDK. Official web playback uses the **YouTube IFrame Player API** (`https://www.youtube.com/iframe_api`), loaded lazily only on explicit user click.
- **Zero credentials required**: Playing curated streams or user-pasted `youtube.com` / `music.youtube.com` playlist or video URLs needs no API key, no OAuth app, and no user account.
- **ToS minimum viewport (`>= 200x200 px`)**: YouTube's official API Terms forbid hiding the iframe as audio-only and require a visible viewport of at least `200×200 px`. Voxelwright mounts a compact `[data-panel="radio-yt"]` mini-player (`216×200 px` iframe viewport) only while YouTube is actively playing, and hides it completely when paused, on FM, or outside the car.
- **Core API**:
  - Playlist: `player.loadPlaylist({ list: id, listType: 'playlist', index: 0 })`
  - Single track / 24/7 live radio: `player.loadVideoById(videoId)`
  - Controls: `playVideo()`, `pauseVideo()`, `nextVideo()`, `previousVideo()`, `setVolume(0..100)` (used for smooth horn/collision ducking)
  - Metadata: `player.getVideoData()` -> `{ video_id, title, author }` + thumbnail `https://i.ytimg.com/vi/<id>/hqdefault.jpg`
  - States (`onStateChange`): `-1` unstarted, `0` ended, `1` playing, `2` paused, `3` buffering, `5` cued
  - Errors (`onError`): `100` / `101` / `150` indicate embed-disabled videos (skip automatically inside playlists or show clear fallback guidance).
- **Saved playlists**: User-pasted YouTube / YouTube Music links are saved strictly client-side in `localStorage` (`voxelwright.radio.youtube.saved`).

## Spotify (Web API + Web Playback SDK — feature-gated off by default)

- **Auth flow**: Authorization Code with **PKCE** (`code_challenge_method=S256`) only. Implicit Grant (`response_type=token`) is deprecated and disabled. No `client_secret` is ever used or stored in the browser.
- **Redirect URI rules (2025/2026)**: `http://localhost:<port>` is banned; local development MUST use `http://127.0.0.1:<port>` or `http://[::1]:<port>` (or `https://`).
- **Required scopes**: `streaming`, `user-read-private`, `user-read-email`, `user-modify-playback-state`, `user-read-playback-state`, `playlist-read-private`, `playlist-read-collaborative`, `user-library-read`.
- **Subscription & Dev Mode limits**: Requires **Spotify Premium** (`account_error` on Free). 2026 Development Mode apps are capped at 5 allowlisted users and may get `403`/`404` on editorial playlists; playlist items migrated from `/tracks` to `/items` (`items?.total ?? tracks?.total`).
- **Autoplay & mobile volume**: Call `player.activateElement()` inside a user gesture; `player.setVolume(0..1)` works on desktop (iOS Safari hardware buttons override JS volume).

## Apple Music (MusicKit JS v3 — feature-gated off by default)

- **SDK script**: `https://js-cdn.music.apple.com/musickit/v3/musickit.js` (loaded lazily on demand).
- **Async configuration (v3)**: `await MusicKit.configure({ developerToken, app: { name: 'Voxelwright', build: '1.0.0' } })` with flattened instance API (`music.play()`, `music.pause()`, `music.skipToNextItem()`, `music.skipToPreviousItem()`, `music.volume = gain`, `music.api.music('/v1/me/library/playlists')`).
- **Account requirement**: Minting a Developer Token JWT requires a paid Apple Developer account (`.p8` MusicKit key); listeners need an Apple Music subscription for full tracks (30 s previews otherwise).

## Privacy, Token Boundaries & Environment Limits

- **Zero hardcoded secrets**: No Spotify Client Secret or Apple MusicKit private key/JWT is committed to the repository.
- **No external network calls at startup or in headless checks**: External SDK scripts (`youtube.com/iframe_api`, `sdk.scdn.co`, `js-cdn.music.apple.com`) load strictly on explicit user play/connect (never on page load or `navigator.webdriver === true` / `?sound=0`).
- **CSP / COEP note**: Local dev server (`engine/serve.mjs`) enforces strict `connect-src` + `COEP: require-corp`. Live external streaming runs on static hosts (`player/serve.mjs` or HTTPS deployments) without restrictive CSP/COEP.
- **Unverified**: Live end-to-end playback with real YouTube streams, Spotify Premium, and Apple Music accounts (including iOS Safari autoplay/volume behavior) has not been executed in CI.

## Refresh when

- `ENABLED_STREAMING_PROVIDERS` changes (e.g., enabling Spotify or Apple Music with registered accounts).
- YouTube changes IFrame Player API ToS minimum dimensions or playlist loading behavior.
- Live-account verification runs on desktop Chrome, Safari, or iOS Safari.
