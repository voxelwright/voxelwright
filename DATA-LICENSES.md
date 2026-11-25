# Data licences

Each layer keeps its source terms when baked. Local Bay packs and derived tiles live outside Git. The tracked SF pilot release manifests and landing metadata include credits for their inputs. Planet tiles use Overture. The page's blended tiles can contain both Overture and local lidar. Credit each contributing source when distributing the corresponding data. [Source checks and release details](.agents/skills/bay-sources/SKILL.md)

| Layer | Source and attribution | Terms |
| --- | --- | --- |
| Surface points, heights and bare ground | US Geological Survey, 3DEP lidar and 1 m DEM | US public domain |
| Building outlines and heights, street centrelines, addresses, curbs and islands, street trees | City and County of San Francisco, DataSF: ynuv-fyni, 3psu-pn9h, 3mea-di5p, emxt-b6yg, tkzw-k3nq respectively | PDDL |
| Parcel shapes, uses and dwelling units | DataSF, c5ge-t6pj | CC0 1.0 |
| Aerial colour | USGS, USDA, The National Map: Orthoimagery (NAIP) | US public domain status to verify before shipping |
| Streets, buildings, land use, tags and associated fixtures | © OpenStreetMap contributors | [ODbL 1.0](https://www.openstreetmap.org/copyright) |
| Planet buildings and building parts, transportation, water, land use, land cover and infrastructure | © OpenStreetMap contributors, Overture Maps Foundation | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) |
| Terrain | Mapterhorn, including USGS 3DEP and Copernicus GLO-30, or Mapzen elevation tiles | Per-source terms. Identify contributing sources per extract. Mapterhorn lists USGS as US public domain and Copernicus under its full, free and open licence. Terrain terms to verify before shipping. [Mapterhorn attribution](https://download.mapterhorn.com/attribution.json) |
| Canopy height | Meta and World Resources Institute (WRI) 2024, High Resolution Canopy Height Maps | CC BY 4.0 |
| Bay floor | NOAA CUDEM and USGS San Francisco Bay 1 m bathymetry (10.5066/P9TJTS8M) | US government work and CC0 respectively, to verify before shipping |
| Street photographs, reconstructed heights, sampled facade colours and detected fixtures including stop signs | © Mapillary and contributing photographers | CC BY-SA. Keep derived layers separable, retain image credits and visibly display the Mapillary logo with a link to [Mapillary](https://www.mapillary.com/) |
| Registered businesses, assessor attributes, shoreline and islands | DataSF g8m3-pdis, wv5m-vpq2 and txuc-3kzm | PDDL 1.0 per the DataSF catalog entries for [businesses](https://data.sfgov.org/api/views/g8m3-pdis), [assessor rolls](https://data.sfgov.org/api/views/wv5m-vpq2) and [shoreline](https://data.sfgov.org/api/views/txuc-3kzm) |
| Street lamps and trolley wires | San Francisco Public Works MapViewer layers 36 and 48 | Unknown. The service metadata for both layers has an empty copyright field. To verify before shipping |

The Ina Coolbrith landing geometry and render adapt Frank Schulenburg's photograph under CC BY-SA 4.0. [Photograph, changes and credits](CREDITS.md#ina-coolbrith-park-landing)
