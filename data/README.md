# Park Roulette seed data

`parks.json` lists 108 parks in Central Oregon (Deschutes, Crook and Jefferson counties). 79 have a playground (61 from the family bucket list and 18 found elsewhere), 2 have nature play, and 27 have no playground. It was built on November 6, 2026.

## How it was built

1. **The family bucket list is the backbone.** `sources/bucket-list-2026-11.txt` is the curated list (90 entries, checked November 4, 2026). It was transcribed into `sources/bucket-list-2026-11.json`. All 90 entries are in `parks.json` with `confidence: "confirmed"`, her address, her notes and her playground status (`play`). Where her list and another source disagree, her list wins. The disagreements are listed below.
2. **OpenStreetMap** (`scripts/01-fetch-osm.mjs`, Overpass API). Fetches playgrounds, playground equipment, parks, schools, toilets, picnic tables, shelters, dog parks, sports pitches, and areas used for exclusion (churches, daycares, campgrounds, resorts, apartments, residential areas), plus county and city boundaries. Only playgrounds inside the three county polygons are kept.
3. **Bend Park & Recreation District** (`scripts/02-fetch-bprd.mjs`). Scrapes all 80 park pages in the BPRD park sitemap at 1 request per second, collecting the address, map pin and amenity list. Her 74 Bend entries match all 74 BPRD parks. The other 6 sitemap pages are buildings (Juniper Swim & Fitness, The Pavilion, Vince Genna Stadium, Senior Center, District Office, Park Operations).
4. **Other operators** (`sources/official-other.json`, transcribed by hand):
   - Crook County Parks & Recreation District, Prineville (ccprd.org): 7 parks whose pages name a playground.
   - La Pine Park & Recreation District (lapineparks.org): 2 parks with playgrounds.
   - Sisters Village Green Park and Culver City Park, which rest on local press and directory listings.
5. **Build** (`scripts/03-build.mjs`):
   - Matches each park to its OSM park polygon, trying in order: exact name, all name words, house number, then the polygon that contains the BPRD pin.
   - Puts the point on the main OSM playground (the largest one) when there is one. Otherwise it uses the park centroid, the BPRD pin, or a geocoded address.
   - Groups every playground in a park into one entry.
   - Gives OSM playgrounds that are outside the curated and official lists their own entries, grouped by park.
   - Applies the hand decisions in `sources/overrides.json`.
6. **Geocoding** (`scripts/04-geocode.mjs`). Used only for parks that are missing from OSM. It tries Nominatim first (1 request per second) and then the US Census geocoder, and accepts only matches at the address level.

To rebuild everything:

```
node scripts/01-fetch-osm.mjs --force
node scripts/02-fetch-bprd.mjs
node scripts/03-build.mjs
node scripts/04-geocode.mjs
node scripts/03-build.mjs
```

The build also writes `raw/build-report.json`, which lists exclusions, dropped playgrounds and disagreements. The scripts use Node 22 with no dependencies.

### Field notes

- **`play`**: `playground`, `nature` (natural play with no structure) or `none`. Every non-bucket entry is `playground`.
- **`kind`**: 107 entries are `park` and 1 is `standalone` (the Coffield Community Center playground in Sisters). No school entries are included; see "Left out" below.
- **`lat` / `lng`**: the playground itself when OSM maps it. Otherwise the park centroid, which applies to these parks on her playground list:
  - Al Moody, Alpenglow, Fieldstone, Goodrich Pasture, Harvest, Hollygrape, Skyline, Stover and Three Pines (Bend)
  - Kalama and West Canyon Rim (Redmond)

  Some points are approximate:
  - Little Fawn uses the BPRD map pin.
  - Gervais, Yellowpine and Finley Butte are geocoded addresses.
  - **Spruce Park and Varnish Park** (Redmond, new in 2023) are in neither OSM nor the geocoders, so each is placed at the street corner it is named for (NW 25th St & NW Spruce Ave, NW 16th St & NW Varnish Ave). Treat these two points as approximate.
- **`features`**: only keys from the agreed list, and only with evidence behind them. Sources:
  - Her tags: Splash pad and Water play give `splash_pad`; Accessible playground gives `accessible`; River gives `water_view`; Dog off-leash gives `dog_park`; Sports fields gives `sports_courts`; Climbing wall gives `climbing`. Some come from her note text, such as "toddler", "swings", "spinning" and "quiet".
  - BPRD amenity lists: restroom, picnic shelter (`picnic` + `shade`), courts and fields, off-leash area, river access, trails.
  - Operator pages for Prineville and La Pine.
  - OSM: playground equipment inside the playground (swings, slides, climbing, spinners, sandpits, zip lines), toilets in the park or within 100 m, picnic tables and shelters, dog parks, splash pads and pitches.

  `shade` means a covered shelter is in the park, not necessarily shade over the play equipment. Her tags that have no feature key are kept in `notes`, for example "Wildside play area.", "Natural play area.", "Fishing.", "Skate park." and "New in 2024.". BPRD's "Water Play Feature" at Rockridge, Stone Creek and Canal Row is **not** mapped to `splash_pad`, because her list says Alpenglow has Bend's only free splash pad.
- **`confidence`**:
  - `confirmed`: her list, an operator's page, or an OSM playground mapped inside a named public park.
  - `likely`: one secondary source, or an OSM playground whose public status is plausible but unconfirmed.
  - `unverified`: directory listings only.
- **`sources`**: `bucket-list-2026-11`, operator URLs, `osm:<type>/<id>`, and `nominatim` or `census-geocoder` where a point was geocoded.

## Counts

| City | playground | nature | none | total |
|---|---|---|---|---|
| Bend | 47 | 2 | 25 | 74 |
| Crooked River Ranch | 1 | 0 | 0 | 1 |
| Culver | 1 | 0 | 0 | 1 |
| La Pine | 2 | 0 | 0 | 2 |
| Madras | 2 | 0 | 0 | 2 |
| Prineville | 7 | 0 | 0 | 7 |
| Redmond | 14 | 0 | 1 | 15 |
| Sisters | 3 | 0 | 0 | 3 |
| Sunriver | 2 | 0 | 0 | 2 |
| Terrebonne | 0 | 0 | 1 | 1 |
| **Total** | **79** | **2** | **27** | **108** |

By confidence: 102 confirmed (90 from her list, 9 from operator pages in Prineville and La Pine, 3 OSM playgrounds in named parks: Juniper Hill and Sahalee in Madras, Cliff Clemens in Sisters), 5 likely, 1 unverified.

Entries added beyond her list (18): Prineville (Crooked River, Gervais, Harwood, Ochoco Creek, Pioneer, Stryker, Yellowpine), La Pine (Finley Butte, Frontier Heritage), Madras (Juniper Hill, Sahalee), Sisters (Cliff Clemens, Village Green, Coffield Community Center), Redmond (High Desert Sports Complex, Umatilla Sports Complex), Crooked River Ranch (Panorama Park), Culver (Culver City Park).

## Where her list and other sources disagree (her classification is kept)

- **Centennial Park (Redmond)**: she lists it as `none` (splash park, no play structure), but OSM maps a playground there (`osm:way/1040398801`). It may be the splash pad mapped as a playground, or a small structure. Worth a look.
- **Smith Rock State Park**: she lists it as `none`. OSM has a bark-surface "playground" node (`osm:node/5501870691`) next to the "Bouldering practice" area by the day-use restrooms. It is probably the climbing practice boulders, not a kids' playground.
- **Pine Ridge Park (Bend)**: she lists a playground and OSM maps one, but BPRD's page for the park does not list "Playground" among its amenities.
- Her playground parks where OSM has the park but **no playground mapped**: Al Moody, Alpenglow, Fieldstone, Goodrich Pasture, Harvest, Hollygrape, Skyline Sports Complex, Stover and Three Pines (Bend), and Kalama and West Canyon Rim (Redmond). BPRD confirms a playground at every one of the Bend parks, so this is an OSM gap, not a doubt. Their points are park centroids.
- Not in OSM at all: Little Fawn (Bend), Spruce and Varnish (Redmond).

## Doubts on the entries added beyond her list

- **Village Green Park (Sisters)**, `likely`: well known for its playground. The 2019 Nugget reported a state grant to replace the play structure, but the City of Sisters site blocks automated access, and OSM doesn't map the playground (the point is the park centroid).
- **Culver City Park**, `unverified`: only directory listings mention slides, swings and a splash pad. KTVZ (October 2025) covers the new skatepark and pickleball courts but not a playground.
- **Coffield Community Center Playground (Sisters)**, `likely`: an OSM playground next to the Sisters Park & Recreation District center and skate park. No name in OSM, so it is named after the center.
- **Panorama Park (Crooked River Ranch)**, `likely`: an OSM playground in a named park with restrooms. Crooked River Ranch is a private owners' association, so check the access rules.
- **High Desert Sports Complex** (Redmond Area Park and Recreation District) and **Umatilla Sports Complex** (City of Redmond), `likely`: the playgrounds come from OSM only. redmondoregon.gov returns 403 to automated requests, so no Redmond page was checked.
- **Stryker Park (Prineville)**: `accessible` is based on the "Inclusive Playground area" CCPRD says was installed in 2024.
- **Pioneer Park**: both Bend and Prineville have one. The slugs are `pioneer-park-bend` (none) and `pioneer-park-prineville` (playground).

## Left out

- **School playgrounds**: 59 OSM playgrounds at 26 schools. None was clearly public after hours, so none is included. Most Bend-La Pine elementary schools are on this list, along with schools in Prineville, Madras, Metolius, La Pine and Brothers.
- **Excluded as not public** (25):
  - Businesses with `access=customers` (5), including Play Society and Dig Crawl Climb.
  - `access=private` (1).
  - Resorts: Seventh Mountain, Black Butte Ranch (2), Eagle Crest (2).
  - Campgrounds: Cove Palisades State Park (2), Pelton Park, Redmond KOA. The Cove Palisades and Pelton playgrounds are in public campgrounds; add them if campground playgrounds count.
  - HOA or subdivision parks: Renaissance Ridge Central Park (Bend), Ochoco Pointe (Prineville), a Bend subdivision near private pools, a Bend motel/subdivision lot.
  - A playground next to a church in Redmond.
  - School playgrounds sitting just outside school polygons: R E Jewell Elementary (3), Three Rivers Elementary in Sunriver (2).
- **Unnamed OSM playgrounds dropped** (12). None sits inside a named park, and none could be given a trustworthy name:
  - Redmond (4): `osm:way/1267835635` at SW Redmond, which may be Valleyview Park (SW 34th St & Reservoir Dr), plus `osm:way/1384216387`, `osm:way/1540669955` and `osm:node/3678334966`.
  - Sisters subdivisions (4).
  - Prineville (2, near First Assembly of God).
  - Madras (1, an unnamed park in a subdivision).
  - Camp Sherman (1, beside private-looking tennis courts).
- **Sunriver**: only Fort Rock and Paulina, as on her list. Mary McCallum Park is owner-only. Other Sunriver Owners Association parks (Besson Commons, Ponderosa Park) have no playground in OSM.
- **Towns with nothing found**: Tumalo, Terrebonne (other than Smith Rock), Powell Butte, Metolius (school only), Camp Sherman and Warm Springs have no public playground in OSM or in any source that could be reached.
- **Sites that could not be reached**: the official city sites for Redmond, Sisters, Madras and Culver block or reset automated requests. Their parks rely on OSM and secondary sources, plus her list for Redmond.
