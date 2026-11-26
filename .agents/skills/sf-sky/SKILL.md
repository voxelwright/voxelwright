---
name: sf-sky
description: San Francisco's real sky for the realm's "SF now" (#524) — the National Weather Service's observations behind the Worker's /weather, and the sun and moon formulas in engine/page/almanac.ts. Load before changing /weather, the weather mapping, the almanac, the blog's SF_NIGHT, or adding another sky or weather source.
---

# San Francisco's sky

Version 1, November 24, 2026 (#524). **fetched**: came back from the URL that day; **read**: the page text was read;
**memory**: unchecked.

## Weather: National Weather Service API (api.weather.gov)

- No key, no account. Public domain (a US government work). It asks for a `User-Agent` naming the caller: we send
  the generic `village-engine (sky)`, never a person's name, email or domain. **read** (weather.gov/documentation/services-web-api)
- `GET https://api.weather.gov/stations/KSFO/observations?limit=8`, `Accept: application/geo+json`: newest first,
  each `properties` has `timestamp`, `presentWeather[].rawString` (METAR codes: `-RA`, `DZ`, `FG`, `BR`, `TSRA`),
  `cloudLayers[] { amount: CLR|FEW|SCT|BKN|OVC|VV, base.value m }`, `visibility.value` m (may be null). Answers in
  about 0.3 s with `cache-control: public, max-age=156, s-maxage=300`. **fetched**
- The station: KSFO (the airport, 13 km south of the city's middle). The city's own station SFOC1 (downtown) reports
  temperature only, no sky or visibility. **fetched** (`/points/37.7749,-122.4194` → `/gridpoints/MTR/85,105/stations`)
- Gap seen over two days (200 reports, Nov 23–25): the hourly :56 METAR sometimes comes with `cloudLayers: []`
  (not even CLR) and an empty `textDescription`; the specials between have the layers. So the Worker takes the newest
  report with layers, and a list with none is a 502. **fetched**
- The marine layer shows at SFO as a low BKN/OVC ceiling over ten miles of visibility. The Worker passes the
  ceiling; under 300 m reads as fog (the city's hills and towers are in it). **memory** for how often that matches
  what the city sees: check against a foggy morning.

Rejected: Open-Meteo `api.open-meteo.com` timed out (TLS connected, no answer) from this Mac and from a second
network on Nov 24, 2026, while its other hosts answered. It is model output, not observation, and free only for
non-commercial use. Reconsider only with a reason.

## Sun and moon: engine/page/almanac.ts

- Meeus' low-precision formulas as suncalc (BSD-2-Clause, github.com/mourner/suncalc) has them, rewritten. World
  axes: x east, y up, z south; suncalc's azimuth is from the south, positive west → `[-sin az cos alt, sin alt, cos az cos alt]`.
- Proved by `node engine/test/almanac.mjs`: the landing photograph's fitted sun within 0.22°, sunrise and sunset of
  2026-11-24 within 2 min of the published, the new and full moons of November 2026, the clock across DST.
- On screen, by `node engine/test/sf-modes.mjs`: tonight's full moon, a 13% crescent after sunset on 12 Nov (lit limb
  toward the set sun), noon, each within 0.2° of the almanac.
- The blog's head carries the same sun inline (`site/generator/pages.mjs` `SF_NIGHT`); `site/test/sf-night.test.mjs`
  holds it to the almanac every 20 minutes for a year. Change both together.

## Refresh when

The NWS changes the observation schema or the station stops reporting; a probe here stops answering; the realm moves
its first view away from San Francisco.
