/**
 * Curated registry of ACS-verified Level I and Level II trauma centers
 * for the United States, plus Landstuhl Regional Medical Center (key
 * overseas DoD facility).
 *
 * Purpose: provide reliable tier data when HIFLD's TRAUMA field is null
 * (common — many hospitals in the federal dataset have no trauma designation
 * recorded) and when OSM does not tag trauma level. The registry is injected
 * into the merge pipeline as a 5th source: it PROMOTES co-located already-
 * fetched facilities to their correct tier, and INJECTS standalone records
 * for centers that were not fetched (outside the OSM/HIFLD search area, or
 * during offline use / fetch failures).
 *
 * Data source: ACS "Find a Hospital" verified trauma center list
 *   https://www.facs.org/find-a-hospital/?nearMe=off&companyType=Trauma
 * Coordinate source: HIFLD Hospitals dataset + OpenStreetMap, cross-checked.
 *
 * Last reviewed: 2026-07
 *
 * Entries flagged `manual: true` are hand-curated and must not be
 * overwritten by the automated refresh script (refreshTraumaCenters.mjs).
 * All other entries are auto-refreshable.
 *
 * To add an entry: fill `name`, `lat`, `lon`, `level`, and `state`. Coordinates
 * need only be within ~2 km of the facility for the co-location promotion to
 * work. Phone, address, and notes are optional but useful for the medic.
 */

import type { LatLon } from '../../calc/geo'

/** US ACS trauma level (1 = highest / Level I, 2 = Level II). */
export type TraumaLevel = 1 | 2

export interface TraumaCenter {
  /** Canonical hospital name shown in the PACE plan. */
  name: string
  /** WGS-84 latitude (decimal degrees). */
  lat: number
  /** WGS-84 longitude (decimal degrees). */
  lon: number
  /** ACS trauma designation level (1 = Level I, 2 = Level II). */
  level: TraumaLevel
  /** US state abbreviation, or 'OVERSEAS' for foreign facilities. */
  state: string
  /**
   * Whether the facility has a rooftop or on-site helipad.
   * Defaults to `true` — virtually all ACS-verified Level I/II centers have
   * landing pads. Set `false` explicitly for exceptions.
   */
  hasHelipad?: boolean
  /** Primary contact number. */
  phone?: string
  /** Street / city address. */
  address?: string
  /** Shown in the PACE screen notes field. */
  notes?: string
  /**
   * When true, this entry was hand-curated and must not be overwritten
   * by the automated refresh script (e.g. overseas facilities not on the
   * US Wikipedia trauma center list).
   */
  manual?: boolean
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const TRAUMA_CENTERS: readonly TraumaCenter[] = [

  // ── Alabama ───────────────────────────────────────────────────────────────
  { name: 'UAB Hospital',                                    lat: 33.5059, lon: -86.7995, level: 1, state: 'AL', phone: '+1 205-934-4011', address: '619 19th St S, Birmingham, AL 35249' },
  { name: 'Huntsville Hospital',                             lat: 34.7280, lon: -86.5835, level: 1, state: 'AL', phone: '+1 256-265-1000', address: '101 Sivley Rd SW, Huntsville, AL 35801' },

  // ── Alaska ────────────────────────────────────────────────────────────────
  { name: 'Providence Alaska Medical Center',                lat: 61.1948, lon: -149.8609, level: 2, state: 'AK', phone: '+1 907-562-2211', address: '3200 Providence Dr, Anchorage, AK 99508' },

  // ── Arizona ───────────────────────────────────────────────────────────────
  { name: 'Banner — University Medical Center Phoenix',      lat: 33.4762, lon: -112.0742, level: 1, state: 'AZ', phone: '+1 602-839-2000', address: '1111 E McDowell Rd, Phoenix, AZ 85006' },
  { name: 'Banner — University Medical Center Tucson',       lat: 32.2381, lon: -110.9506, level: 1, state: 'AZ', phone: '+1 520-694-0111', address: '1625 N Campbell Ave, Tucson, AZ 85719' },
  { name: 'Valleywise Health Medical Center',                lat: 33.4602, lon: -112.0699, level: 1, state: 'AZ', phone: '+1 602-344-5011', address: '2601 E Roosevelt St, Phoenix, AZ 85008', notes: 'Formerly Maricopa Medical Center.' },
  { name: 'HonorHealth Scottsdale Osborn Medical Center',    lat: 33.5017, lon: -111.9246, level: 1, state: 'AZ', phone: '+1 480-882-4000', address: '7400 E Osborn Rd, Scottsdale, AZ 85251' },

  // ── Arkansas ──────────────────────────────────────────────────────────────
  { name: 'UAMS Medical Center',                             lat: 34.7474, lon: -92.3495, level: 1, state: 'AR', phone: '+1 501-686-7000', address: '4301 W Markham St, Little Rock, AR 72205' },

  // ── California ────────────────────────────────────────────────────────────
  { name: 'Cedars-Sinai Medical Center',                     lat: 34.0754, lon: -118.3801, level: 1, state: 'CA', phone: '+1 310-423-3277', address: '8700 Beverly Blvd, Los Angeles, CA 90048' },
  { name: 'Harbor-UCLA Medical Center',                      lat: 33.8656, lon: -118.3147, level: 1, state: 'CA', phone: '+1 310-222-2345', address: '1000 W Carson St, Torrance, CA 90502' },
  { name: 'Keck Hospital of USC',                            lat: 34.0620, lon: -118.2008, level: 1, state: 'CA', phone: '+1 323-442-8500', address: '1500 San Pablo St, Los Angeles, CA 90033' },
  { name: 'LAC+USC Medical Center',                          lat: 34.0492, lon: -118.2065, level: 1, state: 'CA', phone: '+1 323-409-1000', address: '2051 Marengo St, Los Angeles, CA 90033' },
  { name: 'Ronald Reagan UCLA Medical Center',               lat: 34.0664, lon: -118.4448, level: 1, state: 'CA', phone: '+1 310-825-9111', address: '757 Westwood Plaza, Los Angeles, CA 90095' },
  { name: 'Zuckerberg San Francisco General Hospital',       lat: 37.7554, lon: -122.4049, level: 1, state: 'CA', phone: '+1 415-206-8000', address: '1001 Potrero Ave, San Francisco, CA 94110' },
  { name: 'UC Davis Medical Center',                         lat: 38.5538, lon: -121.4533, level: 1, state: 'CA', phone: '+1 916-734-2011', address: '2315 Stockton Blvd, Sacramento, CA 95817' },
  { name: 'Stanford Health Care',                            lat: 37.4349, lon: -122.1747, level: 1, state: 'CA', phone: '+1 650-723-4000', address: '300 Pasteur Dr, Stanford, CA 94305' },
  { name: 'Highland Hospital',                               lat: 37.7751, lon: -122.1976, level: 1, state: 'CA', phone: '+1 510-437-4800', address: '1411 E 31st St, Oakland, CA 94602' },
  { name: 'Scripps Mercy Hospital San Diego',                lat: 32.7390, lon: -117.1641, level: 1, state: 'CA', phone: '+1 619-294-8111', address: '4077 5th Ave, San Diego, CA 92103' },
  { name: 'UC San Diego Health — Hillcrest',                 lat: 32.7527, lon: -117.1594, level: 1, state: 'CA', phone: '+1 619-543-6222', address: '200 W Arbor Dr, San Diego, CA 92103' },
  { name: 'Community Regional Medical Center',               lat: 36.7396, lon: -119.7918, level: 1, state: 'CA', phone: '+1 559-459-6000', address: '2823 Fresno St, Fresno, CA 93721' },
  { name: 'Santa Clara Valley Medical Center',               lat: 37.3171, lon: -121.9413, level: 1, state: 'CA', phone: '+1 408-885-5000', address: '751 S Bascom Ave, San Jose, CA 95128' },
  { name: 'Loma Linda University Medical Center',            lat: 34.0449, lon: -117.2527, level: 1, state: 'CA', phone: '+1 909-558-4000', address: '11234 Anderson St, Loma Linda, CA 92354' },
  { name: 'Riverside University Health System Medical Center', lat: 33.9148, lon: -117.2025, level: 1, state: 'CA', phone: '+1 951-486-4000', address: '26520 Cactus Ave, Moreno Valley, CA 92555' },

  // ── Colorado ──────────────────────────────────────────────────────────────
  { name: 'Denver Health Medical Center',                    lat: 39.7283, lon: -104.9929, level: 1, state: 'CO', phone: '+1 303-436-6000', address: '777 Bannock St, Denver, CO 80204' },
  { name: 'UCHealth Medical Center of the Rockies',          lat: 40.4109, lon: -105.0194, level: 1, state: 'CO', phone: '+1 970-624-2500', address: '2500 Rocky Mountain Ave, Loveland, CO 80538' },
  { name: 'St. Anthony Hospital',                            lat: 39.6991, lon: -105.1046, level: 1, state: 'CO', phone: '+1 720-321-0000', address: '11600 W 2nd Pl, Lakewood, CO 80228' },
  { name: 'UCHealth Memorial Hospital Central',              lat: 38.8339, lon: -104.8214, level: 2, state: 'CO', phone: '+1 719-365-5000', address: '1400 E Boulder St, Colorado Springs, CO 80909', notes: 'Near Fort Carson.' },

  // ── Connecticut ───────────────────────────────────────────────────────────
  { name: 'Yale New Haven Hospital',                         lat: 41.3036, lon: -72.9353, level: 1, state: 'CT', phone: '+1 203-688-4242', address: '20 York St, New Haven, CT 06510' },
  { name: 'Hartford Hospital',                               lat: 41.7645, lon: -72.6813, level: 1, state: 'CT', phone: '+1 860-545-5000', address: '80 Seymour St, Hartford, CT 06102' },

  // ── Delaware ──────────────────────────────────────────────────────────────
  { name: 'Christiana Hospital',                             lat: 39.6704, lon: -75.6835, level: 1, state: 'DE', phone: '+1 302-733-1000', address: '4755 Ogletown-Stanton Rd, Newark, DE 19718' },

  // ── District of Columbia ──────────────────────────────────────────────────
  { name: 'MedStar Washington Hospital Center',              lat: 38.9195, lon: -77.0136, level: 1, state: 'DC', phone: '+1 202-877-7000', address: '110 Irving St NW, Washington, DC 20010' },

  // ── Florida ───────────────────────────────────────────────────────────────
  { name: 'Jackson Memorial Hospital — Ryder Trauma Center', lat: 25.7951, lon: -80.2078, level: 1, state: 'FL', phone: '+1 305-585-1111', address: '1611 NW 12th Ave, Miami, FL 33136' },
  { name: 'Orlando Regional Medical Center',                 lat: 28.5251, lon: -81.3799, level: 1, state: 'FL', phone: '+1 321-841-5111', address: '52 W Underwood St, Orlando, FL 32806' },
  { name: 'Tampa General Hospital',                          lat: 27.9372, lon: -82.4544, level: 1, state: 'FL', phone: '+1 813-844-7000', address: '1 Tampa General Cir, Tampa, FL 33606' },
  { name: 'UF Health Jacksonville',                          lat: 30.3200, lon: -81.6644, level: 1, state: 'FL', phone: '+1 904-244-0411', address: '655 W 8th St, Jacksonville, FL 32209' },
  { name: 'UF Health Shands Hospital',                       lat: 29.6413, lon: -82.3439, level: 1, state: 'FL', phone: '+1 352-265-0111', address: '1600 SW Archer Rd, Gainesville, FL 32610' },
  // Level II — Florida (key facilities near Panama City and military areas)
  { name: 'HCA Florida Gulf Coast Hospital',                 lat: 30.1740, lon: -85.6610, level: 2, state: 'FL', phone: '+1 850-769-1511', address: '449 W 23rd St, Panama City, FL 32405', notes: 'Nearest Level II to the Gulf Coast / Tyndall AFB area.' },
  { name: 'Ascension Sacred Heart Hospital Pensacola',       lat: 30.4340, lon: -87.1990, level: 2, state: 'FL', phone: '+1 850-416-7000', address: '5151 N 9th Ave, Pensacola, FL 32504' },
  { name: 'Tallahassee Memorial Regional Medical Center',    lat: 30.4519, lon: -84.2775, level: 2, state: 'FL', phone: '+1 850-431-1155', address: '1300 Miccosukee Rd, Tallahassee, FL 32308' },
  { name: 'Memorial Hospital Jacksonville',                  lat: 30.3495, lon: -81.5960, level: 2, state: 'FL', phone: '+1 904-399-6111', address: '3625 University Blvd S, Jacksonville, FL 32216' },
  { name: 'Lee Memorial Hospital',                           lat: 26.6380, lon: -81.8604, level: 2, state: 'FL', phone: '+1 239-343-2000', address: '2776 Cleveland Ave, Fort Myers, FL 33901' },
  { name: 'Holmes Regional Medical Center',                  lat: 28.0670, lon: -80.5952, level: 2, state: 'FL', phone: '+1 321-434-7000', address: '1350 S Hickory St, Melbourne, FL 32901' },
  { name: 'Broward Health Medical Center',                   lat: 26.1309, lon: -80.1440, level: 2, state: 'FL', phone: '+1 954-355-4400', address: '1600 S Andrews Ave, Fort Lauderdale, FL 33316' },

  // ── Georgia ───────────────────────────────────────────────────────────────
  { name: 'Grady Memorial Hospital',                         lat: 33.7469, lon: -84.3869, level: 1, state: 'GA', phone: '+1 404-616-4307', address: '80 Jesse Hill Jr Dr SE, Atlanta, GA 30303' },
  { name: 'Augusta University Medical Center',               lat: 33.4735, lon: -82.0099, level: 1, state: 'GA', phone: '+1 706-721-0211', address: '1120 15th St, Augusta, GA 30912' },
  { name: 'Memorial Health University Medical Center',       lat: 32.0641, lon: -81.0779, level: 2, state: 'GA', phone: '+1 912-350-8000', address: '4700 Waters Ave, Savannah, GA 31404', notes: 'Near Hunter Army Airfield / Fort Stewart.' },
  { name: 'Wellstar Kennestone Hospital',                    lat: 33.9569, lon: -84.5403, level: 2, state: 'GA', phone: '+1 770-793-5000', address: '677 Church St NE, Marietta, GA 30060' },

  // ── Hawaii ────────────────────────────────────────────────────────────────
  { name: "The Queen's Medical Center",                      lat: 21.3038, lon: -157.8534, level: 1, state: 'HI', phone: '+1 808-538-9011', address: '1301 Punchbowl St, Honolulu, HI 96813' },

  // ── Idaho ─────────────────────────────────────────────────────────────────
  { name: "St. Luke's Boise Medical Center",                 lat: 43.6157, lon: -116.1954, level: 2, state: 'ID', phone: '+1 208-381-2222', address: '190 E Bannock St, Boise, ID 83712' },
  { name: 'St. Alphonsus Regional Medical Center',           lat: 43.6199, lon: -116.2026, level: 2, state: 'ID', phone: '+1 208-367-2121', address: '1055 N Curtis Rd, Boise, ID 83706' },

  // ── Illinois ──────────────────────────────────────────────────────────────
  { name: 'John H. Stroger Jr. Hospital of Cook County',     lat: 41.8746, lon: -87.6729, level: 1, state: 'IL', phone: '+1 312-864-6000', address: '1969 W Ogden Ave, Chicago, IL 60612' },
  { name: 'Northwestern Memorial Hospital',                  lat: 41.8947, lon: -87.6212, level: 1, state: 'IL', phone: '+1 312-926-2000', address: '251 E Huron St, Chicago, IL 60611' },
  { name: 'Rush University Medical Center',                  lat: 41.8740, lon: -87.6719, level: 1, state: 'IL', phone: '+1 312-942-5000', address: '1620 W Harrison St, Chicago, IL 60612' },
  { name: 'University of Chicago Medical Center',            lat: 41.7892, lon: -87.6051, level: 1, state: 'IL', phone: '+1 773-702-1000', address: '5841 S Maryland Ave, Chicago, IL 60637' },
  { name: 'Advocate Christ Medical Center',                  lat: 41.7180, lon: -87.7564, level: 1, state: 'IL', phone: '+1 708-684-8000', address: '4440 W 95th St, Oak Lawn, IL 60453' },
  { name: 'OSF Saint Francis Medical Center',                lat: 40.7009, lon: -89.6148, level: 1, state: 'IL', phone: '+1 309-655-2000', address: '530 NE Glen Oak Ave, Peoria, IL 61637' },
  { name: 'Memorial Medical Center',                         lat: 39.7958, lon: -89.6498, level: 1, state: 'IL', phone: '+1 217-788-3000', address: '701 N First St, Springfield, IL 62781' },
  { name: 'Loyola University Medical Center',                lat: 41.8607, lon: -87.8476, level: 1, state: 'IL', phone: '+1 708-216-9000', address: '2160 S 1st Ave, Maywood, IL 60153' },

  // ── Indiana ───────────────────────────────────────────────────────────────
  { name: 'Indiana University Health Methodist Hospital',    lat: 39.7762, lon: -86.1786, level: 1, state: 'IN', phone: '+1 317-962-2000', address: '1701 N Senate Ave, Indianapolis, IN 46202' },
  { name: 'Eskenazi Health',                                 lat: 39.7790, lon: -86.1793, level: 1, state: 'IN', phone: '+1 317-880-0000', address: '720 Eskenazi Ave, Indianapolis, IN 46202' },
  { name: 'Memorial Hospital South Bend',                    lat: 41.6814, lon: -86.2325, level: 2, state: 'IN', phone: '+1 574-647-1000', address: '615 N Michigan St, South Bend, IN 46601' },

  // ── Iowa ──────────────────────────────────────────────────────────────────
  { name: 'University of Iowa Hospitals and Clinics',        lat: 41.6608, lon: -91.5368, level: 1, state: 'IA', phone: '+1 319-356-1616', address: '200 Hawkins Dr, Iowa City, IA 52242' },
  { name: 'UnityPoint Health — Iowa Methodist Medical Center', lat: 41.5796, lon: -93.6233, level: 1, state: 'IA', phone: '+1 515-241-6212', address: '1200 Pleasant St, Des Moines, IA 50309' },

  // ── Kansas ────────────────────────────────────────────────────────────────
  { name: 'University of Kansas Hospital',                   lat: 39.0494, lon: -94.6091, level: 1, state: 'KS', phone: '+1 913-588-5000', address: '4000 Cambridge St, Kansas City, KS 66160' },
  { name: 'Stormont Vail Health',                            lat: 39.0570, lon: -95.6894, level: 2, state: 'KS', phone: '+1 785-354-6000', address: '1500 SW 10th Ave, Topeka, KS 66604', notes: 'Near Fort Riley / Junction City.' },

  // ── Kentucky ──────────────────────────────────────────────────────────────
  { name: 'UK Albert B. Chandler Hospital',                  lat: 38.0302, lon: -84.5057, level: 1, state: 'KY', phone: '+1 859-323-5000', address: '1000 S Limestone, Lexington, KY 40536' },
  { name: 'University of Louisville Hospital',               lat: 38.2503, lon: -85.7589, level: 1, state: 'KY', phone: '+1 502-562-3000', address: '530 S Jackson St, Louisville, KY 40202' },

  // ── Louisiana ─────────────────────────────────────────────────────────────
  { name: 'University Medical Center New Orleans',           lat: 29.9502, lon: -90.0884, level: 1, state: 'LA', phone: '+1 504-702-3000', address: '2000 Canal St, New Orleans, LA 70112' },
  { name: 'Our Lady of the Lake Regional Medical Center',    lat: 30.4100, lon: -91.1399, level: 1, state: 'LA', phone: '+1 225-765-6565', address: '5000 Hennessy Blvd, Baton Rouge, LA 70808' },

  // ── Maine ─────────────────────────────────────────────────────────────────
  { name: 'Maine Medical Center',                            lat: 43.6627, lon: -70.2829, level: 1, state: 'ME', phone: '+1 207-662-0111', address: '22 Bramhall St, Portland, ME 04102' },

  // ── Maryland ──────────────────────────────────────────────────────────────
  { name: 'University of Maryland Medical Center — R Adams Cowley Shock Trauma Center', lat: 39.2919, lon: -76.6121, level: 1, state: 'MD', phone: '+1 410-328-8667', address: '22 S Greene St, Baltimore, MD 21201', notes: 'Primary US shock trauma reference centre.' },
  { name: 'Johns Hopkins Hospital',                          lat: 39.2970, lon: -76.5926, level: 1, state: 'MD', phone: '+1 410-955-5000', address: '1800 Orleans St, Baltimore, MD 21287' },
  { name: 'Walter Reed National Military Medical Center',    lat: 38.9997, lon: -77.1022, level: 2, state: 'MD', phone: '+1 301-295-4611', address: '8901 Wisconsin Ave, Bethesda, MD 20889', notes: 'DoD military medical center; accepts trauma casualties.' },

  // ── Massachusetts ─────────────────────────────────────────────────────────
  { name: 'Massachusetts General Hospital',                  lat: 42.3628, lon: -71.0681, level: 1, state: 'MA', phone: '+1 617-726-2000', address: '55 Fruit St, Boston, MA 02114' },
  { name: 'Brigham and Women\'s Hospital',                   lat: 42.3359, lon: -71.1062, level: 1, state: 'MA', phone: '+1 617-732-5500', address: '75 Francis St, Boston, MA 02115' },
  { name: 'Boston Medical Center',                           lat: 42.3352, lon: -71.0722, level: 1, state: 'MA', phone: '+1 617-638-8000', address: '1 Boston Medical Center Pl, Boston, MA 02118' },
  { name: 'UMass Memorial Medical Center',                   lat: 42.2595, lon: -71.8084, level: 1, state: 'MA', phone: '+1 508-334-1000', address: '55 Lake Ave N, Worcester, MA 01655' },
  { name: 'Baystate Medical Center',                         lat: 42.1009, lon: -72.5749, level: 1, state: 'MA', phone: '+1 413-784-0000', address: '759 Chestnut St, Springfield, MA 01199' },

  // ── Michigan ──────────────────────────────────────────────────────────────
  { name: 'Beaumont Hospital, Royal Oak',                    lat: 42.5052, lon: -83.1493, level: 1, state: 'MI', phone: '+1 248-898-5000', address: '3601 W 13 Mile Rd, Royal Oak, MI 48073' },
  { name: 'DMC Detroit Receiving Hospital',                  lat: 42.3487, lon: -83.0510, level: 1, state: 'MI', phone: '+1 313-745-3000', address: '4201 St Antoine, Detroit, MI 48201' },
  { name: 'Henry Ford Hospital',                             lat: 42.3644, lon: -83.0770, level: 1, state: 'MI', phone: '+1 313-916-2600', address: '2799 W Grand Blvd, Detroit, MI 48202' },
  { name: 'University of Michigan Health',                   lat: 42.2831, lon: -83.7304, level: 1, state: 'MI', phone: '+1 734-936-4000', address: '1500 E Medical Center Dr, Ann Arbor, MI 48109' },
  { name: 'Corewell Health Butterworth Hospital',            lat: 42.9632, lon: -85.6696, level: 1, state: 'MI', phone: '+1 616-391-1774', address: '100 Michigan St NE, Grand Rapids, MI 49503', notes: 'Formerly Spectrum Health Butterworth.' },

  // ── Minnesota ─────────────────────────────────────────────────────────────
  { name: 'Regions Hospital',                                lat: 44.9539, lon: -93.0841, level: 1, state: 'MN', phone: '+1 651-254-3456', address: '640 Jackson St, Saint Paul, MN 55101' },
  { name: 'Hennepin Healthcare',                             lat: 44.9726, lon: -93.2649, level: 1, state: 'MN', phone: '+1 612-873-3000', address: '701 Park Ave, Minneapolis, MN 55415' },
  { name: 'Mayo Clinic Hospital — Saint Marys Campus',       lat: 44.0233, lon: -92.4653, level: 1, state: 'MN', phone: '+1 507-255-5123', address: '1216 2nd St SW, Rochester, MN 55902' },

  // ── Mississippi ───────────────────────────────────────────────────────────
  { name: 'University of Mississippi Medical Center',        lat: 32.3366, lon: -90.2018, level: 1, state: 'MS', phone: '+1 601-984-1000', address: '2500 N State St, Jackson, MS 39216' },

  // ── Missouri ──────────────────────────────────────────────────────────────
  { name: 'Barnes-Jewish Hospital',                          lat: 38.6323, lon: -90.2618, level: 1, state: 'MO', phone: '+1 314-747-3000', address: '1 Barnes-Jewish Hospital Plaza, St. Louis, MO 63110' },
  { name: 'Saint Luke\'s Hospital of Kansas City',           lat: 39.0459, lon: -94.5822, level: 1, state: 'MO', phone: '+1 816-932-2000', address: '4401 Wornall Rd, Kansas City, MO 64111' },

  // ── Montana ───────────────────────────────────────────────────────────────
  { name: 'Benefis Health System',                           lat: 47.5005, lon: -111.3081, level: 2, state: 'MT', phone: '+1 406-455-5000', address: '1101 26th St S, Great Falls, MT 59405' },
  { name: 'St. Patrick Hospital',                            lat: 46.8756, lon: -113.9965, level: 2, state: 'MT', phone: '+1 406-543-7271', address: '500 W Broadway, Missoula, MT 59802' },

  // ── Nebraska ──────────────────────────────────────────────────────────────
  { name: 'Nebraska Medicine — Nebraska Medical Center',     lat: 41.2589, lon: -95.9750, level: 1, state: 'NE', phone: '+1 402-552-2000', address: '4350 Dewey Ave, Omaha, NE 68105' },

  // ── Nevada ────────────────────────────────────────────────────────────────
  { name: 'University Medical Center of Southern Nevada',   lat: 36.1688, lon: -115.1694, level: 1, state: 'NV', phone: '+1 702-383-2000', address: '1800 W Charleston Blvd, Las Vegas, NV 89102' },
  { name: 'Renown Regional Medical Center',                  lat: 39.5309, lon: -119.8171, level: 1, state: 'NV', phone: '+1 775-982-4100', address: '1155 Mill St, Reno, NV 89502' },

  // ── New Hampshire ─────────────────────────────────────────────────────────
  { name: 'Dartmouth Hitchcock Medical Center',              lat: 43.6461, lon: -72.2999, level: 1, state: 'NH', phone: '+1 603-650-5000', address: '1 Medical Center Dr, Lebanon, NH 03756' },

  // ── New Jersey ────────────────────────────────────────────────────────────
  { name: 'University Hospital, Newark',                     lat: 40.7460, lon: -74.1921, level: 1, state: 'NJ', phone: '+1 973-972-4300', address: '150 Bergen St, Newark, NJ 07103' },
  { name: 'Robert Wood Johnson University Hospital',         lat: 40.4966, lon: -74.4492, level: 1, state: 'NJ', phone: '+1 732-828-3000', address: '1 Robert Wood Johnson Pl, New Brunswick, NJ 08901' },
  { name: 'Cooper University Hospital',                      lat: 39.9407, lon: -75.1039, level: 1, state: 'NJ', phone: '+1 856-342-2000', address: '1 Cooper Plaza, Camden, NJ 08103' },

  // ── New Mexico ────────────────────────────────────────────────────────────
  { name: 'University of New Mexico Hospital',               lat: 35.0928, lon: -106.5900, level: 1, state: 'NM', phone: '+1 505-272-2111', address: '2211 Lomas Blvd NE, Albuquerque, NM 87106' },

  // ── New York ──────────────────────────────────────────────────────────────
  { name: 'NYC Health + Hospitals / Bellevue',               lat: 40.7389, lon: -73.9779, level: 1, state: 'NY', phone: '+1 212-562-4141', address: '462 First Ave, New York, NY 10016' },
  { name: 'NYC Health + Hospitals / Kings County',           lat: 40.6565, lon: -73.9448, level: 1, state: 'NY', phone: '+1 718-245-3131', address: '451 Clarkson Ave, Brooklyn, NY 11203' },
  { name: 'NYC Health + Hospitals / Jacobi',                 lat: 40.8640, lon: -73.8552, level: 1, state: 'NY', phone: '+1 718-918-5000', address: '1400 Pelham Pkwy S, Bronx, NY 10461' },
  { name: 'NYC Health + Hospitals / Elmhurst',               lat: 40.7423, lon: -73.8771, level: 1, state: 'NY', phone: '+1 718-334-4000', address: '79-01 Broadway, Elmhurst, NY 11373' },
  { name: 'Nassau University Medical Center',                lat: 40.7225, lon: -73.5446, level: 1, state: 'NY', phone: '+1 516-572-0123', address: '2201 Hempstead Tpke, East Meadow, NY 11554' },
  { name: 'Albany Medical Center',                           lat: 42.6543, lon: -73.7618, level: 1, state: 'NY', phone: '+1 518-262-3125', address: '43 New Scotland Ave, Albany, NY 12208' },
  { name: 'SUNY Upstate University Hospital',                lat: 43.0361, lon: -76.1378, level: 1, state: 'NY', phone: '+1 315-464-5540', address: '750 E Adams St, Syracuse, NY 13210' },
  { name: 'Strong Memorial Hospital',                        lat: 43.1259, lon: -77.6314, level: 1, state: 'NY', phone: '+1 585-275-2121', address: '601 Elmwood Ave, Rochester, NY 14642' },
  { name: 'Erie County Medical Center',                      lat: 42.8949, lon: -78.7961, level: 1, state: 'NY', phone: '+1 716-898-3000', address: '462 Grider St, Buffalo, NY 14215' },
  { name: 'Westchester Medical Center',                      lat: 41.0815, lon: -73.7988, level: 1, state: 'NY', phone: '+1 914-493-7000', address: '100 Woods Rd, Valhalla, NY 10595' },
  { name: 'Stony Brook University Hospital',                 lat: 40.9047, lon: -73.1198, level: 1, state: 'NY', phone: '+1 631-444-4000', address: '101 Nicolls Rd, Stony Brook, NY 11794' },
  { name: 'NewYork-Presbyterian/Weill Cornell Medical Center', lat: 40.7646, lon: -73.9537, level: 1, state: 'NY', phone: '+1 212-746-5454', address: '525 E 68th St, New York, NY 10065' },
  { name: 'NYU Langone Health — Tisch Hospital',             lat: 40.7424, lon: -73.9742, level: 1, state: 'NY', phone: '+1 212-263-7300', address: '550 First Ave, New York, NY 10016' },
  { name: 'NewYork-Presbyterian/Columbia University Irving', lat: 40.8426, lon: -73.9427, level: 1, state: 'NY', phone: '+1 212-305-2500', address: '622 W 168th St, New York, NY 10032' },

  // ── North Carolina ────────────────────────────────────────────────────────
  { name: 'UNC Medical Center',                              lat: 35.9058, lon: -79.0494, level: 1, state: 'NC', phone: '+1 984-974-1000', address: '101 Manning Dr, Chapel Hill, NC 27514' },
  { name: 'Duke University Hospital',                        lat: 36.0069, lon: -78.9434, level: 1, state: 'NC', phone: '+1 919-684-8111', address: '2301 Erwin Rd, Durham, NC 27710' },
  { name: 'Atrium Health Carolinas Medical Center',          lat: 35.2079, lon: -80.8383, level: 1, state: 'NC', phone: '+1 704-355-2000', address: '1000 Blythe Blvd, Charlotte, NC 28203' },
  { name: 'Atrium Health Wake Forest Baptist Medical Center', lat: 36.1009, lon: -80.2450, level: 1, state: 'NC', phone: '+1 336-716-2011', address: '1 Medical Center Blvd, Winston-Salem, NC 27157' },
  { name: 'Cape Fear Valley Medical Center',                  lat: 35.0452, lon: -78.9013, level: 2, state: 'NC', phone: '+1 910-615-4000', address: '1638 Owen Dr, Fayetteville, NC 28304', notes: 'Near Fort Liberty (formerly Fort Bragg). Primary Level II for the 82nd Airborne area.' },
  { name: 'Duke Regional Hospital',                          lat: 36.0363, lon: -78.9119, level: 2, state: 'NC', phone: '+1 919-470-4000', address: '3643 N Roxboro St, Durham, NC 27704' },

  // ── North Dakota ──────────────────────────────────────────────────────────
  { name: 'Sanford Medical Center Fargo',                    lat: 46.8567, lon: -96.8034, level: 2, state: 'ND', phone: '+1 701-234-2000', address: '801 Broadway N, Fargo, ND 58122' },

  // ── Ohio ──────────────────────────────────────────────────────────────────
  { name: 'Cleveland Clinic',                                lat: 41.5024, lon: -81.6219, level: 1, state: 'OH', phone: '+1 216-444-2200', address: '9500 Euclid Ave, Cleveland, OH 44195' },
  { name: 'MetroHealth Medical Center',                      lat: 41.4865, lon: -81.7014, level: 1, state: 'OH', phone: '+1 216-778-7800', address: '2500 MetroHealth Dr, Cleveland, OH 44109' },
  { name: 'Ohio State University Wexner Medical Center',     lat: 39.9993, lon: -83.0205, level: 1, state: 'OH', phone: '+1 614-293-8000', address: '370 W 9th Ave, Columbus, OH 43210' },
  { name: 'OhioHealth Grant Medical Center',                 lat: 39.9583, lon: -82.9990, level: 1, state: 'OH', phone: '+1 614-566-9000', address: '111 S Grant Ave, Columbus, OH 43215' },
  { name: 'Miami Valley Hospital',                           lat: 39.7608, lon: -84.1908, level: 1, state: 'OH', phone: '+1 937-208-8000', address: '1 Wyoming St, Dayton, OH 45409' },
  { name: 'University Hospitals Cleveland Medical Center',   lat: 41.5076, lon: -81.6013, level: 1, state: 'OH', phone: '+1 216-844-1000', address: '11100 Euclid Ave, Cleveland, OH 44106' },

  // ── Oklahoma ──────────────────────────────────────────────────────────────
  { name: 'OU Health — The University of Oklahoma Medical Center', lat: 35.4702, lon: -97.4860, level: 1, state: 'OK', phone: '+1 405-271-4700', address: '700 NE 13th St, Oklahoma City, OK 73104' },

  // ── Oregon ────────────────────────────────────────────────────────────────
  { name: 'OHSU Hospital',                                   lat: 45.4979, lon: -122.6861, level: 1, state: 'OR', phone: '+1 503-494-8311', address: '3181 SW Sam Jackson Park Rd, Portland, OR 97239' },
  { name: 'Legacy Emanuel Medical Center',                   lat: 45.5376, lon: -122.6686, level: 1, state: 'OR', phone: '+1 503-413-2200', address: '2801 N Gantenbein Ave, Portland, OR 97227' },

  // ── Pennsylvania ──────────────────────────────────────────────────────────
  { name: 'Penn Medicine / Hospital of the University of Pennsylvania', lat: 39.9494, lon: -75.1948, level: 1, state: 'PA', phone: '+1 215-662-4000', address: '3400 Spruce St, Philadelphia, PA 19104' },
  { name: 'Thomas Jefferson University Hospital',            lat: 39.9474, lon: -75.1585, level: 1, state: 'PA', phone: '+1 215-955-6000', address: '111 S 11th St, Philadelphia, PA 19107' },
  { name: 'Temple University Hospital',                      lat: 39.9782, lon: -75.1505, level: 1, state: 'PA', phone: '+1 215-707-2000', address: '3401 N Broad St, Philadelphia, PA 19140' },
  { name: 'Jefferson Einstein Medical Center Philadelphia',  lat: 40.0193, lon: -75.1540, level: 1, state: 'PA', phone: '+1 215-456-7890', address: '5501 Old York Rd, Philadelphia, PA 19141' },
  { name: 'UPMC Presbyterian',                               lat: 40.4440, lon: -79.9586, level: 1, state: 'PA', phone: '+1 412-647-2345', address: '200 Lothrop St, Pittsburgh, PA 15213' },
  { name: 'Allegheny General Hospital',                      lat: 40.4574, lon: -79.9969, level: 1, state: 'PA', phone: '+1 412-359-3131', address: '320 E North Ave, Pittsburgh, PA 15212' },
  { name: 'Geisinger Medical Center',                        lat: 40.9622, lon: -76.6019, level: 1, state: 'PA', phone: '+1 570-271-6211', address: '100 N Academy Ave, Danville, PA 17822' },
  { name: 'Penn State Milton S. Hershey Medical Center',     lat: 40.2690, lon: -76.6484, level: 1, state: 'PA', phone: '+1 717-531-8521', address: '500 University Dr, Hershey, PA 17033' },

  // ── Rhode Island ──────────────────────────────────────────────────────────
  { name: 'Rhode Island Hospital',                           lat: 41.8204, lon: -71.4223, level: 1, state: 'RI', phone: '+1 401-444-4000', address: '593 Eddy St, Providence, RI 02903' },

  // ── South Carolina ────────────────────────────────────────────────────────
  { name: 'Prisma Health Richland Hospital',                 lat: 33.9922, lon: -81.0370, level: 1, state: 'SC', phone: '+1 803-434-7000', address: '5 Richland Medical Park Dr, Columbia, SC 29203' },
  { name: 'MUSC Health University Medical Center',           lat: 32.7841, lon: -79.9526, level: 1, state: 'SC', phone: '+1 843-792-2300', address: '169 Ashley Ave, Charleston, SC 29425' },
  { name: 'Prisma Health Greenville Memorial Hospital',      lat: 34.8373, lon: -82.4121, level: 2, state: 'SC', phone: '+1 864-455-7000', address: '701 Grove Rd, Greenville, SC 29605' },

  // ── South Dakota ──────────────────────────────────────────────────────────
  { name: 'Sanford USD Medical Center',                      lat: 43.5543, lon: -96.7285, level: 2, state: 'SD', phone: '+1 605-333-1000', address: '1305 W 18th St, Sioux Falls, SD 57105' },
  { name: 'Rapid City Regional Hospital',                    lat: 44.0805, lon: -103.2310, level: 2, state: 'SD', phone: '+1 605-755-1000', address: '353 Fairmont Blvd, Rapid City, SD 57701' },

  // ── Tennessee ─────────────────────────────────────────────────────────────
  { name: 'Vanderbilt University Medical Center',            lat: 36.1444, lon: -86.8022, level: 1, state: 'TN', phone: '+1 615-322-5000', address: '1211 Medical Center Dr, Nashville, TN 37232' },
  { name: 'Regional One Health',                             lat: 35.1366, lon: -90.0460, level: 1, state: 'TN', phone: '+1 901-545-7100', address: '877 Jefferson Ave, Memphis, TN 38103' },
  { name: 'UT Medical Center',                               lat: 35.9578, lon: -83.9183, level: 1, state: 'TN', phone: '+1 865-305-9000', address: '1924 Alcoa Hwy, Knoxville, TN 37920' },
  { name: 'Erlanger Medical Center',                         lat: 35.0429, lon: -85.2983, level: 1, state: 'TN', phone: '+1 423-778-7000', address: '975 E 3rd St, Chattanooga, TN 37403' },

  // ── Texas ─────────────────────────────────────────────────────────────────
  { name: 'University Hospital Bexar County',                lat: 29.5090, lon: -98.5802, level: 1, state: 'TX', phone: '+1 210-358-4000', address: '4502 Medical Dr, San Antonio, TX 78229', notes: 'Near Joint Base San Antonio; primary trauma Level I for JBSA area.' },
  { name: 'Parkland Memorial Hospital',                      lat: 32.8088, lon: -96.8402, level: 1, state: 'TX', phone: '+1 214-590-8000', address: '5200 Harry Hines Blvd, Dallas, TX 75235' },
  { name: 'UT Southwestern / Clements University Hospital',  lat: 32.8173, lon: -96.8366, level: 1, state: 'TX', phone: '+1 214-645-3300', address: '5323 Harry Hines Blvd, Dallas, TX 75390' },
  { name: 'Baylor Scott & White All Saints Medical Center',  lat: 32.7374, lon: -97.3578, level: 2, state: 'TX', phone: '+1 817-926-2544', address: '1400 8th Ave, Fort Worth, TX 76104' },
  { name: 'JPS Health Network',                              lat: 32.7524, lon: -97.3488, level: 1, state: 'TX', phone: '+1 817-921-3431', address: '1500 S Main St, Fort Worth, TX 76104' },
  { name: 'Harris Health Ben Taub Hospital',                 lat: 29.7085, lon: -95.3987, level: 1, state: 'TX', phone: '+1 713-873-2000', address: '1504 Taub Loop, Houston, TX 77030' },
  { name: 'Memorial Hermann — Texas Medical Center',         lat: 29.7053, lon: -95.3990, level: 1, state: 'TX', phone: '+1 713-704-4000', address: '6411 Fannin St, Houston, TX 77030' },
  { name: 'University of Texas Medical Branch — Galveston',  lat: 29.3105, lon: -94.7749, level: 1, state: 'TX', phone: '+1 409-772-1011', address: '301 University Blvd, Galveston, TX 77555' },
  { name: 'University Medical Center of El Paso',            lat: 31.7717, lon: -106.4994, level: 1, state: 'TX', phone: '+1 915-521-7602', address: '4815 Alameda Ave, El Paso, TX 79905', notes: 'Near Fort Bliss.' },
  { name: 'UMC Health System Lubbock',                       lat: 33.5853, lon: -101.8729, level: 1, state: 'TX', phone: '+1 806-775-8200', address: '602 Indiana Ave, Lubbock, TX 79415' },
  { name: 'Baylor Scott & White Medical Center — Temple',    lat: 31.1065, lon: -97.3655, level: 2, state: 'TX', phone: '+1 254-724-2111', address: '2401 S 31st St, Temple, TX 76508', notes: 'Near Fort Cavazos (formerly Fort Hood).' },
  { name: 'Valley Baptist Medical Center',                   lat: 25.9083, lon: -97.4760, level: 2, state: 'TX', phone: '+1 956-389-1100', address: '2101 Pease St, Harlingen, TX 78550', notes: 'Southernmost Level II in Texas; Rio Grande Valley.' },

  // ── Utah ──────────────────────────────────────────────────────────────────
  { name: 'University of Utah Health',                       lat: 40.7649, lon: -111.8421, level: 1, state: 'UT', phone: '+1 801-581-2121', address: '50 N Medical Dr, Salt Lake City, UT 84132' },
  { name: 'Intermountain Medical Center',                    lat: 40.6614, lon: -111.8984, level: 1, state: 'UT', phone: '+1 801-507-7000', address: '5121 S Cottonwood St, Murray, UT 84107' },

  // ── Vermont ───────────────────────────────────────────────────────────────
  { name: 'University of Vermont Medical Center',            lat: 44.4756, lon: -73.2073, level: 1, state: 'VT', phone: '+1 802-847-0000', address: '111 Colchester Ave, Burlington, VT 05401' },

  // ── Virginia ──────────────────────────────────────────────────────────────
  { name: 'VCU Health Medical College of Virginia Campus',   lat: 37.5408, lon: -77.4354, level: 1, state: 'VA', phone: '+1 804-828-9000', address: '1250 E Marshall St, Richmond, VA 23298' },
  { name: 'Inova Fairfax Hospital',                          lat: 38.8759, lon: -77.2041, level: 1, state: 'VA', phone: '+1 703-776-4001', address: '3300 Gallows Rd, Falls Church, VA 22042', notes: 'Primary Level I for the DC/Northern Virginia corridor.' },
  { name: 'Sentara Norfolk General Hospital',                lat: 36.8842, lon: -76.3133, level: 1, state: 'VA', phone: '+1 757-388-3000', address: '600 Gresham Dr, Norfolk, VA 23507', notes: 'Primary Level I for Hampton Roads / Naval Station Norfolk area.' },
  { name: 'Carilion Roanoke Memorial Hospital',              lat: 37.2609, lon: -79.9477, level: 2, state: 'VA', phone: '+1 540-981-7000', address: '1906 Belleview Ave SE, Roanoke, VA 24014' },

  // ── Washington ────────────────────────────────────────────────────────────
  { name: 'Harborview Medical Center',                       lat: 47.6036, lon: -122.3282, level: 1, state: 'WA', phone: '+1 206-744-3000', address: '325 9th Ave, Seattle, WA 98104' },
  { name: 'Providence Sacred Heart Medical Center',          lat: 47.6505, lon: -117.4030, level: 1, state: 'WA', phone: '+1 509-474-3131', address: '101 W 8th Ave, Spokane, WA 99204' },
  { name: 'MultiCare Tacoma General Hospital',               lat: 47.2529, lon: -122.4443, level: 2, state: 'WA', phone: '+1 253-403-1000', address: '315 Martin Luther King Jr Way, Tacoma, WA 98405', notes: 'Near Joint Base Lewis-McChord (JBLM).' },

  // ── West Virginia ─────────────────────────────────────────────────────────
  { name: 'WVU Medicine Ruby Memorial Hospital',             lat: 39.6512, lon: -79.9630, level: 1, state: 'WV', phone: '+1 304-598-4000', address: '1 Medical Center Dr, Morgantown, WV 26506' },
  { name: 'CAMC General Hospital',                           lat: 38.3498, lon: -81.6326, level: 1, state: 'WV', phone: '+1 304-388-5432', address: '501 Morris St, Charleston, WV 25301' },

  // ── Wisconsin ─────────────────────────────────────────────────────────────
  { name: 'UW Health — University Hospital',                 lat: 43.0741, lon: -89.4263, level: 1, state: 'WI', phone: '+1 608-263-6400', address: '600 Highland Ave, Madison, WI 53792' },
  { name: 'Froedtert and The Medical College of Wisconsin',  lat: 43.0449, lon: -88.0371, level: 1, state: 'WI', phone: '+1 414-805-3000', address: '9200 W Wisconsin Ave, Milwaukee, WI 53226' },

  // ── Wyoming ───────────────────────────────────────────────────────────────
  { name: 'Wyoming Medical Center',                          lat: 42.8561, lon: -106.3048, level: 2, state: 'WY', phone: '+1 307-577-7201', address: '1233 E 2nd St, Casper, WY 82601' },

  // ── Overseas ──────────────────────────────────────────────────────────────
  {
    name: 'Landstuhl Regional Medical Center',
    lat: 49.4005, lon: 7.5728,
    level: 1, state: 'OVERSEAS',
    phone: '+49 6371 86 0',
    address: 'CMR 402, APO AE 09180, Landstuhl, Germany',
    notes: 'Primary US DoD overseas trauma / Role 4 facility. ACS Level I–equivalent. All major US military trauma casualties from European and CENTCOM AORs are evacuated here.',
    manual: true,
  },

]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Haversine distance in metres (inlined to avoid circular-dependency). */
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const dφ = ((lat2 - lat1) * Math.PI) / 180
  const dλ = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return all trauma centers within `radiusM` metres of `target`.
 *
 * Used in the main fetch pipeline to inject registry entries into the
 * `mergeFacilities` call for both promotion of co-located fetched hospitals
 * and injection of unfetched centers.
 */
export function selectTraumaCentersInRadius(
  target: LatLon,
  radiusM: number,
): readonly TraumaCenter[] {
  return TRAUMA_CENTERS.filter(
    tc => haversineM(target.lat, target.lon, tc.lat, tc.lon) <= radiusM,
  )
}

/**
 * Return the nearest Level-I (`level === 1`) trauma center within `maxRadiusM`
 * of `target`, or `null` when none is found.
 *
 * Used by `expandedLevelI.ts` for the network-free Level-I guarantee lookup:
 * if the registry contains a Level I within 500 km, no Overpass/HIFLD fetch
 * is needed — the registry entry is converted to a FacilityRecord directly.
 */
export function nearestLevelITraumaCenter(
  target: LatLon,
  maxRadiusM: number,
): TraumaCenter | null {
  let nearest: TraumaCenter | null = null
  let nearestDist = Infinity
  for (const tc of TRAUMA_CENTERS) {
    if (tc.level !== 1) continue
    const d = haversineM(target.lat, target.lon, tc.lat, tc.lon)
    if (d <= maxRadiusM && d < nearestDist) {
      nearestDist = d
      nearest = tc
    }
  }
  return nearest
}

/** Exported for unit tests only — do not import in production code. */
export const _testOnly = { TRAUMA_CENTERS }
