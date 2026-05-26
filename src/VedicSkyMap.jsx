import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as Astronomy from 'astronomy-engine';

// =============================================================================
// CONSTANTS
// =============================================================================

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

// =============================================================================
// ASTRONOMICAL UTILITIES (most heavy-lifting now delegated to astronomy-engine)
// =============================================================================

// Lahiri/Chitrapaksha ayanāṃśa polynomial (good to ~1 arcmin for 1900-2100)
// For jyotiṣa-grade accuracy, swap this for Swiss Ephemeris swe_get_ayanamsa(jd, SE_SIDM_LAHIRI)
function lahiriAyanamsa(jd) {
  const T = (jd - 2451545.0) / 36525.0;
  return 23.85 + 1.3975 * T + 0.000308 * T * T;
}

function dateToJD(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

// Mean obliquity (IAU 2006)
function obliquity(jd) {
  const T = (jd - 2451545.0) / 36525.0;
  return 23.43929111 - 0.0130041667 * T - 1.6667e-7 * T * T;
}

// GMST in degrees (used for LST -> Lagna)
function gmstDeg(jd) {
  const T = (jd - 2451545.0) / 36525.0;
  let gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0)
    + 0.000387933 * T * T - (T * T * T) / 38710000;
  return ((gmst % 360) + 360) % 360;
}

// Convert ecliptic (lon, lat) to equatorial (RA, Dec)
function eclToEq(lonDeg, latDeg, epsDeg) {
  const lon = lonDeg * DEG, lat = latDeg * DEG, eps = epsDeg * DEG;
  const sinDec = Math.sin(lat) * Math.cos(eps) + Math.cos(lat) * Math.sin(eps) * Math.sin(lon);
  const dec = Math.asin(sinDec);
  const y = Math.sin(lon) * Math.cos(eps) - Math.tan(lat) * Math.sin(eps);
  const x = Math.cos(lon);
  let ra = Math.atan2(y, x) * RAD;
  if (ra < 0) ra += 360;
  return { ra, dec: dec * RAD };
}

// Convert equatorial (RA, Dec) to horizontal (alt, az). Azimuth: 0=N, 90=E, 180=S, 270=W.
function eqToHor(raDeg, decDeg, latDeg, lstDeg) {
  const H = (lstDeg - raDeg) * DEG;
  const dec = decDeg * DEG, lat = latDeg * DEG;
  const sinAlt = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(H);
  const alt = Math.asin(sinAlt);
  const sinA = -Math.cos(dec) * Math.sin(H);
  const cosA = Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(H);
  let az = Math.atan2(sinA, cosA) * RAD;
  return { alt: alt * RAD, az: ((az % 360) + 360) % 360 };
}

// Stereographic projection from zenith: alt/az -> unit-circle (x, y).
// Sky view orientation: N top, E LEFT, S bottom, W right.
function projectStereographic(altDeg, azDeg) {
  if (altDeg < -2) return null;
  const r = Math.tan((90 - altDeg) * DEG / 2);
  const az = azDeg * DEG;
  return { x: -r * Math.sin(az), y: -r * Math.cos(az) };
}

// Ascendant (Lagna) with hemisphere-safe disambiguation.
function ascendantTropical(lstDeg, latDeg, epsDeg) {
  const ramc = lstDeg * DEG, eps = epsDeg * DEG, lat = latDeg * DEG;
  const y = -Math.cos(ramc);
  const x = Math.sin(eps) * Math.tan(lat) + Math.cos(eps) * Math.sin(ramc);
  let asc = Math.atan2(y, x) * RAD;
  if (asc < 0) asc += 360;
  const eq = eclToEq(asc, 0, epsDeg);
  const hor = eqToHor(eq.ra, eq.dec, latDeg, lstDeg);
  if (hor.az > 180) asc = (asc + 180) % 360;
  return asc;
}

// =============================================================================
// PLANET ENGINE: astronomy-engine, accurate to ~1 arcmin
// =============================================================================

function planetEcliptic(body, date) {
  const v = Astronomy.GeoVector(body, date, true);
  const ecl = Astronomy.Ecliptic(v);
  return { lon: ecl.elon, lat: ecl.elat };
}

function meanRahuTropical(jd) {
  const T = (jd - 2451545.0) / 36525.0;
  let omega = 125.0445479 - 1934.1362891 * T + 0.0020754 * T * T;
  return ((omega % 360) + 360) % 360;
}

function dailyMotion(body, date) {
  const lon1 = planetEcliptic(body, date).lon;
  const later = new Date(date.getTime() + 86400000);
  const lon2 = planetEcliptic(body, later).lon;
  let d = lon2 - lon1;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

// =============================================================================
// CATALOGUES
// =============================================================================

const NAKSHATRAS = [
  { n: 1, name: 'Aśvinī', tamil: 'Aśvinī', star: 'β Arietis (Sheratan)', ra: 28.660, dec: 20.808, mag: 2.64, lord: 'Ketu' },
  { n: 2, name: 'Bharaṇī', tamil: 'Bharaṇī', star: '35 Arietis', ra: 41.030, dec: 27.708, mag: 4.66, lord: 'Venus' },
  { n: 3, name: 'Kṛttikā', tamil: 'Kārttikai', star: 'η Tauri (Alcyone)', ra: 56.871, dec: 24.105, mag: 2.87, lord: 'Sun' },
  { n: 4, name: 'Rohiṇī', tamil: 'Rōhiṇi', star: 'α Tauri (Aldebaran)', ra: 68.980, dec: 16.509, mag: 0.87, lord: 'Moon' },
  { n: 5, name: 'Mṛgaśīrṣā', tamil: 'Mṛkacīrṣam', star: 'λ Orionis (Meissa)', ra: 83.785, dec: 9.934, mag: 3.39, lord: 'Mars' },
  { n: 6, name: 'Ārdrā', tamil: 'Tiruvātirai', star: 'α Orionis (Betelgeuse)', ra: 88.793, dec: 7.407, mag: 0.42, lord: 'Rahu' },
  { n: 7, name: 'Punarvasu', tamil: 'Punarpūcam', star: 'β Geminorum (Pollux)', ra: 116.329, dec: 28.026, mag: 1.14, lord: 'Jupiter' },
  { n: 8, name: 'Puṣya', tamil: 'Pūcam', star: 'δ Cancri (Asellus Aus.)', ra: 130.821, dec: 18.154, mag: 3.94, lord: 'Saturn' },
  { n: 9, name: 'Āśleṣā', tamil: 'Āyilyam', star: 'ε Hydrae', ra: 133.847, dec: 6.419, mag: 3.38, lord: 'Mercury' },
  { n: 10, name: 'Maghā', tamil: 'Makam', star: 'α Leonis (Regulus)', ra: 152.093, dec: 11.967, mag: 1.40, lord: 'Ketu' },
  { n: 11, name: 'Pūrva Phalgunī', tamil: 'Pūram', star: 'δ Leonis (Zosma)', ra: 168.527, dec: 20.524, mag: 2.56, lord: 'Venus' },
  { n: 12, name: 'Uttara Phalgunī', tamil: 'Uttiram', star: 'β Leonis (Denebola)', ra: 177.265, dec: 14.572, mag: 2.14, lord: 'Sun' },
  { n: 13, name: 'Hasta', tamil: 'Astam', star: 'δ Corvi (Algorab)', ra: 187.466, dec: -16.515, mag: 2.94, lord: 'Moon' },
  { n: 14, name: 'Citrā', tamil: 'Cittirai', star: 'α Virginis (Spica)', ra: 201.298, dec: -11.161, mag: 1.04, lord: 'Mars' },
  { n: 15, name: 'Svātī', tamil: 'Cuvāti', star: 'α Boötis (Arcturus)', ra: 213.915, dec: 19.182, mag: -0.05, lord: 'Rahu' },
  { n: 16, name: 'Viśākhā', tamil: 'Vicākam', star: 'α Librae (Zubenelgenubi)', ra: 222.720, dec: -16.042, mag: 2.75, lord: 'Jupiter' },
  { n: 17, name: 'Anurādhā', tamil: 'Anuṣam', star: 'δ Scorpii (Dschubba)', ra: 240.083, dec: -22.622, mag: 2.32, lord: 'Saturn' },
  { n: 18, name: 'Jyeṣṭhā', tamil: 'Kēṭṭai', star: 'α Scorpii (Antares)', ra: 247.352, dec: -26.432, mag: 1.06, lord: 'Mercury' },
  { n: 19, name: 'Mūla', tamil: 'Mūlam', star: 'λ Scorpii (Shaula)', ra: 263.402, dec: -37.104, mag: 1.62, lord: 'Ketu' },
  { n: 20, name: 'Pūrva Āṣāḍhā', tamil: 'Pūrāṭam', star: 'δ Sagittarii (Kaus M.)', ra: 275.249, dec: -29.828, mag: 2.70, lord: 'Venus' },
  { n: 21, name: 'Uttara Āṣāḍhā', tamil: 'Uttirāṭam', star: 'σ Sagittarii (Nunki)', ra: 283.816, dec: -26.297, mag: 2.05, lord: 'Sun' },
  { n: 22, name: 'Śravaṇa', tamil: 'Tiruvōṇam', star: 'α Aquilae (Altair)', ra: 297.696, dec: 8.868, mag: 0.77, lord: 'Moon' },
  { n: 23, name: 'Dhaniṣṭhā', tamil: 'Aviṭṭam', star: 'β Delphini (Rotanev)', ra: 308.303, dec: 14.595, mag: 3.63, lord: 'Mars' },
  { n: 24, name: 'Śatabhiṣā', tamil: 'Catayam', star: 'λ Aquarii', ra: 343.155, dec: -7.580, mag: 3.73, lord: 'Rahu' },
  { n: 25, name: 'Pūrva Bhādrapadā', tamil: 'Pūraṭṭāti', star: 'α Pegasi (Markab)', ra: 346.190, dec: 15.205, mag: 2.49, lord: 'Jupiter' },
  { n: 26, name: 'Uttara Bhādrapadā', tamil: 'Uttiraṭṭāti', star: 'γ Pegasi (Algenib)', ra: 3.309, dec: 15.184, mag: 2.83, lord: 'Saturn' },
  { n: 27, name: 'Revatī', tamil: 'Rēvati', star: 'ζ Piscium', ra: 17.694, dec: 7.886, mag: 5.21, lord: 'Mercury' },
];

const NAMED_STARS = [
  { name: 'Lubdhaka (Sirius)', star: 'α Canis Majoris', ra: 101.287, dec: -16.716, mag: -1.46 },
  { name: 'Agastya (Canopus)', star: 'α Carinae', ra: 95.988, dec: -52.696, mag: -0.74 },
  { name: 'Brahmahṛdaya (Capella)', star: 'α Aurigae', ra: 79.172, dec: 45.998, mag: 0.08 },
  { name: 'Prajāpati', star: 'δ Aurigae', ra: 89.882, dec: 54.285, mag: 3.72 },
  { name: 'Abhijit (Vega)', star: 'α Lyrae', ra: 279.234, dec: 38.784, mag: 0.03 },
  { name: 'Hamsa (Deneb)', star: 'α Cygni', ra: 310.358, dec: 45.280, mag: 1.25 },
  { name: 'Apām Vatsa (Procyon)', star: 'α Canis Minoris', ra: 114.825, dec: 5.225, mag: 0.34 },
  { name: 'Rigel', star: 'β Orionis', ra: 78.634, dec: -8.202, mag: 0.18 },
  { name: 'Kratu', star: 'α UMa (Dubhe)', ra: 165.932, dec: 61.751, mag: 1.79 },
  { name: 'Pulaha', star: 'β UMa (Merak)', ra: 165.460, dec: 56.382, mag: 2.37 },
  { name: 'Pulastya', star: 'γ UMa (Phecda)', ra: 178.458, dec: 53.695, mag: 2.44 },
  { name: 'Atri', star: 'δ UMa (Megrez)', ra: 183.857, dec: 57.033, mag: 3.31 },
  { name: 'Aṅgiras', star: 'ε UMa (Alioth)', ra: 193.507, dec: 55.960, mag: 1.77 },
  { name: 'Vasiṣṭha', star: 'ζ UMa (Mizar)', ra: 200.981, dec: 54.926, mag: 2.04 },
  { name: 'Marīci', star: 'η UMa (Alkaid)', ra: 206.885, dec: 49.313, mag: 1.86 },
  { name: 'Dhruva (Polaris)', star: 'α UMi', ra: 37.955, dec: 89.264, mag: 1.98 },
  { name: 'Agni (Elnath)', star: 'β Tauri', ra: 81.573, dec: 28.608, mag: 1.65 },
];

const RASHIS = [
  { n: 1, name: 'Meṣa', en: 'Aries' }, { n: 2, name: 'Vṛṣabha', en: 'Taurus' },
  { n: 3, name: 'Mithuna', en: 'Gemini' }, { n: 4, name: 'Karka', en: 'Cancer' },
  { n: 5, name: 'Siṃha', en: 'Leo' }, { n: 6, name: 'Kanyā', en: 'Virgo' },
  { n: 7, name: 'Tulā', en: 'Libra' }, { n: 8, name: 'Vṛścika', en: 'Scorpio' },
  { n: 9, name: 'Dhanus', en: 'Sagittarius' }, { n: 10, name: 'Makara', en: 'Capricorn' },
  { n: 11, name: 'Kumbha', en: 'Aquarius' }, { n: 12, name: 'Mīna', en: 'Pisces' },
];

const PLANETS = [
  { key: 'Sun', label: '☉', name: 'Sūrya', body: Astronomy.Body.Sun, color: '#f5c542' },
  { key: 'Moon', label: '☽', name: 'Candra', body: Astronomy.Body.Moon, color: '#e8e8e8' },
  { key: 'Mercury', label: '☿', name: 'Budha', body: Astronomy.Body.Mercury, color: '#9bc6e0' },
  { key: 'Venus', label: '♀', name: 'Śukra', body: Astronomy.Body.Venus, color: '#fce0a0' },
  { key: 'Mars', label: '♂', name: 'Maṅgala', body: Astronomy.Body.Mars, color: '#e07050' },
  { key: 'Jupiter', label: '♃', name: 'Guru', body: Astronomy.Body.Jupiter, color: '#e8b870' },
  { key: 'Saturn', label: '♄', name: 'Śani', body: Astronomy.Body.Saturn, color: '#7a8090' },
];

// =============================================================================
// PAÑCĀṄGA REFERENCE DATA
// =============================================================================

// Tithi names (1-15 = śukla pakṣa, 16-29 = kṛṣṇa pakṣa, 30 = Amāvāsyā)
const TITHI_NAMES = [
  'Pratipadā', 'Dvitīyā', 'Tṛtīyā', 'Caturthī', 'Pañcamī',
  'Ṣaṣṭhī', 'Saptamī', 'Aṣṭamī', 'Navamī', 'Daśamī',
  'Ekādaśī', 'Dvādaśī', 'Trayodaśī', 'Caturdaśī', 'Pūrṇimā',
  'Pratipadā', 'Dvitīyā', 'Tṛtīyā', 'Caturthī', 'Pañcamī',
  'Ṣaṣṭhī', 'Saptamī', 'Aṣṭamī', 'Navamī', 'Daśamī',
  'Ekādaśī', 'Dvādaśī', 'Trayodaśī', 'Caturdaśī', 'Amāvāsyā',
];

// 27 yogas (Sun + Moon longitudes, divided into 27 parts)
const YOGA_NAMES = [
  'Viṣkambha', 'Prīti', 'Āyuṣmān', 'Saubhāgya', 'Śobhana',
  'Atigaṇḍa', 'Sukarmā', 'Dhṛti', 'Śūla', 'Gaṇḍa',
  'Vṛddhi', 'Dhruva', 'Vyāghāta', 'Harṣaṇa', 'Vajra',
  'Siddhi', 'Vyatīpāta', 'Variyāna', 'Parigha', 'Śiva',
  'Siddha', 'Sādhya', 'Śubha', 'Śukla', 'Brahmā',
  'Indra', 'Vaidhṛti',
];

// Traditional classification of yogas as auspicious or inauspicious for muhūrta.
// The 9 'aśubha' yogas are: Viṣkambha, Atigaṇḍa, Śūla, Gaṇḍa, Vyāghāta, Vajra, Vyatīpāta, Parigha, Vaidhṛti.
const YOGA_QUALITY = {
  'Viṣkambha': 'aśubha (avoid)',
  'Prīti': 'śubha',
  'Āyuṣmān': 'śubha',
  'Saubhāgya': 'śubha',
  'Śobhana': 'śubha',
  'Atigaṇḍa': 'aśubha (avoid)',
  'Sukarmā': 'śubha',
  'Dhṛti': 'śubha',
  'Śūla': 'aśubha (avoid)',
  'Gaṇḍa': 'aśubha (avoid)',
  'Vṛddhi': 'śubha',
  'Dhruva': 'śubha',
  'Vyāghāta': 'aśubha (avoid)',
  'Harṣaṇa': 'śubha',
  'Vajra': 'aśubha (avoid)',
  'Siddhi': 'śubha',
  'Vyatīpāta': 'aśubha (avoid)',
  'Variyāna': 'śubha',
  'Parigha': 'aśubha (avoid)',
  'Śiva': 'śubha',
  'Siddha': 'śubha',
  'Sādhya': 'śubha',
  'Śubha': 'śubha',
  'Śukla': 'śubha',
  'Brahmā': 'śubha',
  'Indra': 'śubha',
  'Vaidhṛti': 'aśubha (avoid)',
};

// Karaṇa: 60 half-tithis per lunar month.
// Positions 1, 58, 59, 60 are the 4 fixed (sthira) karaṇas around Amāvāsyā.
// Positions 2-57 cycle through 7 movable (cara) karaṇas, 8 times.
const MOVABLE_KARANAS = ['Bava', 'Bālava', 'Kaulava', 'Taitila', 'Garaja', 'Vaṇija', 'Viṣṭi'];
// Viṣṭi karaṇa is also known as Bhadrā - traditionally inauspicious
const FIXED_KARANAS = {
  58: 'Śakuni',
  59: 'Catuṣpāda',
  60: 'Nāga',
  1: 'Kiṃstughna',
};

function getKaranaName(position) {
  // position is 1..60 within the lunar month
  if (FIXED_KARANAS[position]) return FIXED_KARANAS[position];
  // Movable karaṇas occupy positions 2..57
  // Position 2 -> Bava (idx 0), position 3 -> Bālava (idx 1), ...
  const idx = (position - 2) % 7;
  return MOVABLE_KARANAS[idx];
}

// Vāra (weekday) - traditional ordering starting Sunday with Sūrya
const VARAS = ['Ravivāra', 'Somavāra', 'Maṅgalavāra', 'Budhavāra', 'Guruvāra', 'Śukravāra', 'Śanivāra'];
const VARA_PLANET = ['Sūrya', 'Candra', 'Maṅgala', 'Budha', 'Guru', 'Śukra', 'Śani'];

// Compute pañcāṅga elements from sidereal sun and moon longitudes
function computePanchanga(sunSidLon, moonSidLon, date) {
  // Tithi: Moon - Sun, in 12° units
  const elongation = ((moonSidLon - sunSidLon) + 360) % 360;
  const tithiNumber = Math.floor(elongation / 12) + 1; // 1..30
  const tithiProgress = (elongation % 12) / 12; // 0..1 within current tithi
  const paksha = tithiNumber <= 15 ? 'Śukla' : 'Kṛṣṇa';
  const tithiName = TITHI_NAMES[tithiNumber - 1];

  // Yoga: Sun + Moon, in (360/27) units
  const yogaSum = (sunSidLon + moonSidLon) % 360;
  const yogaSpan = 360 / 27;
  const yogaNumber = Math.floor(yogaSum / yogaSpan) + 1;
  const yogaName = YOGA_NAMES[yogaNumber - 1];

  // Karaṇa: half-tithi
  const karanaPosition = Math.floor(elongation / 6) + 1; // 1..60
  const karanaName = getKaranaName(karanaPosition);
  // Which half of the tithi we're in (0 = first half, 1 = second half)
  const karanaHalf = Math.floor((elongation % 12) / 6);

  // Vāra (weekday). JS getDay(): 0=Sunday
  const varaIdx = date.getDay();
  const varaName = VARAS[varaIdx];
  const varaPlanet = VARA_PLANET[varaIdx];

  return {
    elongation,
    tithi: {
      number: tithiNumber,
      name: tithiName,
      paksha,
      progress: tithiProgress,
    },
    yoga: {
      number: yogaNumber,
      name: yogaName,
    },
    karana: {
      position: karanaPosition,
      name: karanaName,
      half: karanaHalf, // 0 = first half of tithi, 1 = second half
    },
    vara: {
      number: varaIdx,
      name: varaName,
      planet: varaPlanet,
    },
  };
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function VedicSkyMap() {
  const [now, setNow] = useState(new Date());
  const [lat, setLat] = useState(-27.4698);
  const [lon, setLon] = useState(153.0251);
  const [locName, setLocName] = useState('Brisbane');
  const [showRashi, setShowRashi] = useState(true);
  const [showNakshatra, setShowNakshatra] = useState(true);
  const [showNakBands, setShowNakBands] = useState(false);
  const [showPada, setShowPada] = useState(false);
  const [showStars, setShowStars] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showTithiArc, setShowTithiArc] = useState(true);
  // Label size: 'small', 'medium' (default), 'large'. Persisted to localStorage.
  const [labelSize, setLabelSize] = useState(() => {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('ayanamsha-label-size') || 'medium';
    }
    return 'medium';
  });
  useEffect(() => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('ayanamsha-label-size', labelSize);
    }
  }, [labelSize]);
  const [selected, setSelected] = useState(null);
  const [size, setSize] = useState(640);

  // Animation state. speedMultiplier = how fast simulated time advances vs real time.
  // 1 = real-time live mode. 1440 = "1 day per minute" (Lagna sweep). Etc.
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const [playing, setPlaying] = useState(true); // true at speed=1 means live; at speeds > 1 means animating
  const [showTrails, setShowTrails] = useState(false);

  // Trails: rolling buffer of recent planet positions (sky-coords) for each planet
  const trailsRef = useRef({}); // { Mars: [{x,y}, ...], ... }

  const containerRef = useRef(null);
  const rafRef = useRef(null);
  const lastFrameTimeRef = useRef(null);

  useEffect(() => {
    function updateSize() {
      if (containerRef.current) {
        const w = containerRef.current.offsetWidth;
        setSize(Math.min(w, 720));
      }
    }
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Location search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const searchTimerRef = useRef(null);

  // Animation loop. Uses requestAnimationFrame for smooth motion at any speed.
  // At speedMultiplier=1 with playing=true, this is equivalent to "live" mode.
  // At higher speeds, simulated time advances faster: simulated_dt = real_dt * speedMultiplier.
  useEffect(() => {
    if (!playing) {
      lastFrameTimeRef.current = null;
      return;
    }

    function tick(timestamp) {
      if (lastFrameTimeRef.current == null) {
        lastFrameTimeRef.current = timestamp;
      }
      const realDtMs = timestamp - lastFrameTimeRef.current;
      lastFrameTimeRef.current = timestamp;

      if (speedMultiplier === 1) {
        // Live mode: snap to wall clock so display stays accurate
        setNow(new Date());
      } else {
        // Animation mode: advance simulated time at speedMultiplier × real time
        setNow(prev => new Date(prev.getTime() + realDtMs * speedMultiplier));
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastFrameTimeRef.current = null;
    };
  }, [playing, speedMultiplier]);

  const sky = useMemo(() => {
    const jd = dateToJD(now);
    const ayan = lahiriAyanamsa(jd);
    const eps = obliquity(jd);
    const gmst = gmstDeg(jd);
    const lst = (gmst + lon + 360) % 360;

    const planets = PLANETS.map(p => {
      const ecl = planetEcliptic(p.body, now);
      const tropLon = ecl.lon, eclLat = ecl.lat;
      const sidLon = ((tropLon - ayan) + 360) % 360;
      const eq = eclToEq(tropLon, eclLat, eps);
      const hor = eqToHor(eq.ra, eq.dec, lat, lst);
      const proj = projectStereographic(hor.alt, hor.az);
      let retrograde = false, motion = 0;
      if (p.key !== 'Sun' && p.key !== 'Moon') {
        motion = dailyMotion(p.body, now);
        retrograde = motion < 0;
      }
      return { ...p, tropLon, eclLat, sidLon, alt: hor.alt, az: hor.az, p: proj, retrograde, motion };
    });

    const rahuTrop = meanRahuTropical(jd);
    const ketuTrop = (rahuTrop + 180) % 360;
    function nodePoint(tropLon, color, key, name, label) {
      const sidLon = ((tropLon - ayan) + 360) % 360;
      const eq = eclToEq(tropLon, 0, eps);
      const hor = eqToHor(eq.ra, eq.dec, lat, lst);
      return { key, name, label, color, tropLon, eclLat: 0, sidLon,
        alt: hor.alt, az: hor.az, p: projectStereographic(hor.alt, hor.az) };
    }
    const nodes = [
      nodePoint(rahuTrop, '#7a5cff', 'Rahu', 'Rāhu', '☊'),
      nodePoint(ketuTrop, '#a07a4f', 'Ketu', 'Ketu', '☋'),
    ];

    const ascTrop = ascendantTropical(lst, lat, eps);
    const ascSid = ((ascTrop - ayan) + 360) % 360;
    const ascEq = eclToEq(ascTrop, 0, eps);
    const ascHor = eqToHor(ascEq.ra, ascEq.dec, lat, lst);
    const ascProj = { alt: ascHor.alt, az: ascHor.az, p: projectStereographic(ascHor.alt, ascHor.az) };

    const ecliptic = [];
    for (let l = 0; l <= 360; l += 2) {
      const eq2 = eclToEq(l, 0, eps);
      const hor = eqToHor(eq2.ra, eq2.dec, lat, lst);
      ecliptic.push({ tropLon: l, p: projectStereographic(hor.alt, hor.az) });
    }

    function projStar(s) {
      const hor = eqToHor(s.ra, s.dec, lat, lst);
      return { ...s, alt: hor.alt, az: hor.az, p: projectStereographic(hor.alt, hor.az) };
    }
    const nakStars = NAKSHATRAS.map(projStar);
    const otherStars = NAMED_STARS.map(projStar);

    const rashiBounds = [];
    for (let r = 0; r < 12; r++) {
      const sidL = r * 30;
      const tropL = (sidL + ayan) % 360;
      const eq2 = eclToEq(tropL, 0, eps);
      const hor = eqToHor(eq2.ra, eq2.dec, lat, lst);
      rashiBounds.push({ rashi: RASHIS[r], sidLon: sidL, p: projectStereographic(hor.alt, hor.az) });
    }

    const nakSpan = 360 / 27;
    const nakBounds = [];
    for (let n = 0; n < 27; n++) {
      const sidL = n * nakSpan;
      const tropL = (sidL + ayan) % 360;
      const eq2 = eclToEq(tropL, 0, eps);
      const hor = eqToHor(eq2.ra, eq2.dec, lat, lst);
      nakBounds.push({ nak: NAKSHATRAS[n], sidLon: sidL, p: projectStereographic(hor.alt, hor.az) });
    }

    const padaSpan = nakSpan / 4;
    const padaBounds = [];
    for (let i = 0; i < 108; i++) {
      if (i % 4 === 0) continue;
      const sidL = i * padaSpan;
      const tropL = (sidL + ayan) % 360;
      const eq2 = eclToEq(tropL, 0, eps);
      const hor = eqToHor(eq2.ra, eq2.dec, lat, lst);
      padaBounds.push({ sidLon: sidL, p: projectStereographic(hor.alt, hor.az) });
    }

    // Pañcāṅga - compute from Sun and Moon sidereal longitudes
    const sunPlanet = planets.find(p => p.key === 'Sun');
    const moonPlanet = planets.find(p => p.key === 'Moon');
    const panchanga = computePanchanga(sunPlanet.sidLon, moonPlanet.sidLon, now);

    // Tithi arc: sample the ecliptic from Sun's tropical longitude to Moon's tropical longitude
    // going eastward (in the direction Moon is moving away from Sun).
    // Note: we use tropical for projection (since star coords are tropical-of-date too).
    const sunTrop = sunPlanet.tropLon;
    const moonTrop = moonPlanet.tropLon;
    let arcSpan = ((moonTrop - sunTrop) + 360) % 360; // 0..360, the elongation in tropical
    // Sample arc points at 2° intervals along the ecliptic from Sun to Moon
    const tithiArc = [];
    if (arcSpan > 0.5) {
      const steps = Math.max(2, Math.ceil(arcSpan / 2));
      for (let i = 0; i <= steps; i++) {
        const l = (sunTrop + (arcSpan * i / steps)) % 360;
        const eq2 = eclToEq(l, 0, eps);
        const hor = eqToHor(eq2.ra, eq2.dec, lat, lst);
        tithiArc.push({ tropLon: l, p: projectStereographic(hor.alt, hor.az) });
      }
    }
    // Karaṇa notch: the half-tithi boundary closest to the Moon.
    // This is where the karaṇa changes within the current tithi (each tithi has 2 karaṇas).
    // Tithi runs from tithiStartElong to tithiStartElong + 12°. Karaṇa boundary sits at +6°.
    // We always show this boundary; it may sit ahead of the Moon (first half of tithi)
    // or behind the Moon (second half of tithi). When Moon is exactly on it, karaṇa is changing.
    const tithiStartElong = Math.floor(arcSpan / 12) * 12;
    const karanaBoundaryElong = tithiStartElong + 6;
    let karanaNotch = null;
    // Only plot if karaṇa boundary lies within the arc range that contains useful information.
    // Skip very small arcs (right after new moon) where the boundary would be too close to Sun.
    if (karanaBoundaryElong > 0 && karanaBoundaryElong < 360 && arcSpan > 0.5) {
      const l = (sunTrop + karanaBoundaryElong) % 360;
      const eq2 = eclToEq(l, 0, eps);
      const hor = eqToHor(eq2.ra, eq2.dec, lat, lst);
      karanaNotch = projectStereographic(hor.alt, hor.az);
    }

    return {
      jd, ayan, eps, lst, gmst,
      planets, nodes, ascSid, ascTrop, ascProj,
      ecliptic, nakStars, otherStars,
      rashiBounds, nakBounds, padaBounds,
      panchanga, tithiArc, karanaNotch,
    };
  }, [now, lat, lon]);

  function rashiOf(sidLon) {
    const idx = Math.floor(sidLon / 30);
    return { rashi: RASHIS[idx], deg: sidLon - idx * 30 };
  }
  function nakshatraOf(sidLon) {
    const span = 360 / 27;
    const idx = Math.floor(sidLon / span);
    const within = sidLon - idx * span;
    return { nak: NAKSHATRAS[idx], pada: Math.floor(within / (span / 4)) + 1 };
  }
  function fmtDeg(d) {
    const deg = Math.floor(d);
    const m = (d - deg) * 60;
    const min = Math.floor(m);
    const sec = Math.round((m - min) * 60);
    return `${deg}° ${String(min).padStart(2,'0')}' ${String(sec).padStart(2,'0')}"`;
  }

  const R = size / 2 - 20;
  const cx = size / 2, cy = size / 2;
  const toPx = p => ({ x: cx + p.x * R, y: cy + p.y * R });

  // Label sizing: a multiplier applied to all SVG text font sizes.
  // Small=current behaviour, Medium=1.4x (default), Large=1.8x.
  const labelScale = labelSize === 'small' ? 1.0 : labelSize === 'large' ? 1.8 : 1.4;
  // Helper: scaled font size string
  const fs = (px) => `${(px * labelScale).toFixed(1)}`;

  // Trail tracking: each render, push the current sky-coords of every planet (and Lagna)
  // into a rolling buffer. Cap the trail length and prune old entries.
  // Trails make most sense at higher animation speeds where motion is visible.
  const TRAIL_LENGTH = 80;
  useEffect(() => {
    if (!showTrails) {
      trailsRef.current = {};
      return;
    }
    const trails = trailsRef.current;
    function push(key, point) {
      if (!point) return;
      if (!trails[key]) trails[key] = [];
      trails[key].push({ x: point.x, y: point.y });
      if (trails[key].length > TRAIL_LENGTH) trails[key].shift();
    }
    for (const pl of sky.planets) push(pl.key, pl.p);
    for (const nd of sky.nodes) push(nd.key, nd.p);
    push('Lagna', sky.ascProj.p);
  }, [now, showTrails, lat, lon]);

  const eclipticSegments = useMemo(() => {
    const segs = [];
    let cur = [];
    for (const e of sky.ecliptic) {
      if (e.p) {
        const px = toPx(e.p);
        cur.push(`${cur.length === 0 ? 'M' : 'L'} ${px.x.toFixed(2)} ${px.y.toFixed(2)}`);
      } else if (cur.length) {
        segs.push(cur.join(' '));
        cur = [];
      }
    }
    if (cur.length) segs.push(cur.join(' '));
    return segs;
  }, [sky.ecliptic, size]);

  function magToRadius(mag) {
    return Math.max(0.6, 3.2 - 0.55 * (mag + 1));
  }

  function shiftTime(hours) {
    setPlaying(false);
    setNow(new Date(now.getTime() + hours * 3600 * 1000));
  }
  function reset() {
    setSpeedMultiplier(1);
    setPlaying(true);
    setNow(new Date());
  }

  // Animation speed presets. Each value = simulated seconds per real second.
  // 1 = live. 60 = "1 min/sec". 720 = slow sky rotation. 1440 = Lagna sweep.
  // 10000 = Moon drifting through nakṣatras.
  const SPEED_PRESETS = [
    { label: '1×', value: 1, title: 'Live (real-time)' },
    { label: '60×', value: 60, title: '1 minute per second' },
    { label: '720×', value: 720, title: 'Slow sky rotation' },
    { label: '1440×', value: 1440, title: 'Lagna sweep: 1 day per minute' },
    { label: '10k×', value: 10000, title: 'Moon drifts through nakṣatras' },
  ];

  function setSpeed(mult) {
    setSpeedMultiplier(mult);
    setPlaying(true);
    // Reset trails when speed changes - they look weird otherwise
    trailsRef.current = {};
  }

  // ---- Location helpers ----

  // Use the browser's geolocation API to get the user's actual lat/lon.
  // Requires user permission. Falls back gracefully if denied or unavailable.
  function useMyLocation() {
    if (!navigator.geolocation) {
      setSearchError('Geolocation not supported by this browser');
      return;
    }
    setSearchError(null);
    setSearching(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLon(pos.coords.longitude);
        setLocName('My location');
        setSearchResults([]);
        setSearchQuery('');
        setSearching(false);
      },
      (err) => {
        setSearching(false);
        setSearchError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied'
            : 'Could not get location'
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
    );
  }

  // Debounced city search using Open-Meteo's free geocoding API.
  // No API key required. Returns up to 5 results matching the query.
  // Open-Meteo has nicer disambiguation than Nominatim for cities specifically.
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!searchQuery || searchQuery.trim().length < 2) {
      setSearchResults([]);
      setSearchError(null);
      return;
    }
    setSearching(true);
    setSearchError(null);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(searchQuery.trim())}&count=5&language=en&format=json`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Search failed');
        const data = await res.json();
        setSearchResults(data.results || []);
        setSearching(false);
      } catch (e) {
        setSearchError('Search failed — check connection');
        setSearchResults([]);
        setSearching(false);
      }
    }, 350);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery]);

  function pickResult(r) {
    setLat(r.latitude);
    setLon(r.longitude);
    // Display name: "Hyderabad, Telangana, IN"
    const parts = [r.name];
    if (r.admin1 && r.admin1 !== r.name) parts.push(r.admin1);
    if (r.country_code) parts.push(r.country_code);
    setLocName(parts.join(', '));
    setSearchResults([]);
    setSearchQuery('');
    setSearchError(null);
  }

  const PRESETS = [
    { name: 'Brisbane', lat: -27.4698, lon: 153.0251 },
    { name: 'Chennai', lat: 13.0827, lon: 80.2707 },
    { name: 'Varanasi', lat: 25.3176, lon: 82.9739 },
    { name: 'Ujjain', lat: 23.1765, lon: 75.7885 },
    { name: 'Tirupati', lat: 13.6288, lon: 79.4192 },
    { name: 'Delhi', lat: 28.6139, lon: 77.2090 },
  ];

  const eastPt = toPx({ x: -1, y: 0 });
  const westPt = toPx({ x: 1, y: 0 });
  const northPt = toPx({ x: 0, y: -1 });
  const southPt = toPx({ x: 0, y: 1 });

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(ellipse at top, #0a0e27 0%, #050714 60%, #02030a 100%)',
      color: '#e8e0c8',
      fontFamily: '"Cormorant Garamond", "EB Garamond", Georgia, serif',
      padding: '16px',
    }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 12, letterSpacing: '0.3em', color: '#b8956a',
            textTransform: 'uppercase', marginBottom: 4 }}>Khagola Darśana</div>
          <h1 style={{ fontSize: 32, fontWeight: 400, margin: 0, letterSpacing: '0.02em',
            fontFamily: '"Cormorant SC", "Cormorant Garamond", serif', color: '#f0e4c2' }}>
            Vedic Sky Map</h1>
          <div style={{ fontSize: 11, color: '#8a7a5a', marginTop: 4, letterSpacing: '0.1em' }}>
            astronomy-engine (~1 arcmin) · Lahiri ayanāṃśa · sidereal · stereographic
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: size >= 600 ? '1fr 280px' : '1fr', gap: 16 }}>
          <div ref={containerRef} style={{ background: 'rgba(8, 10, 24, 0.6)',
            border: '1px solid rgba(184, 149, 106, 0.2)', borderRadius: 8, padding: 16 }}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
              <defs>
                <radialGradient id="skyGrad" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#0a1535" stopOpacity="0.6" />
                  <stop offset="70%" stopColor="#050a20" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#02030a" stopOpacity="0.2" />
                </radialGradient>
                <filter id="starGlow">
                  <feGaussianBlur stdDeviation="0.8" result="b" />
                  <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>

              <circle cx={cx} cy={cy} r={R} fill="url(#skyGrad)" stroke="#b8956a" strokeWidth="1.2" />

              {[30, 60].map(alt => (
                <circle key={alt} cx={cx} cy={cy} r={R * Math.tan((90 - alt) * DEG / 2)}
                  fill="none" stroke="rgba(184, 149, 106, 0.15)" strokeWidth="0.5" strokeDasharray="2 4" />
              ))}

              <text x={northPt.x} y={northPt.y - 8} textAnchor="middle" fill="#b8956a" fontSize={fs(11)} letterSpacing="0.15em">N</text>
              <text x={southPt.x} y={southPt.y + 18} textAnchor="middle" fill="#b8956a" fontSize={fs(11)} letterSpacing="0.15em">S</text>
              <text x={eastPt.x - 10} y={eastPt.y + 4} textAnchor="end" fill="#d4a850" fontSize={fs(12)} letterSpacing="0.15em" fontWeight="500">E</text>
              <text x={westPt.x + 10} y={westPt.y + 4} textAnchor="start" fill="#b8956a" fontSize={fs(11)} letterSpacing="0.15em">W</text>

              {eclipticSegments.map((d, i) => (
                <path key={i} d={d} fill="none" stroke="#5a8aff" strokeWidth="1" strokeOpacity="0.6" strokeDasharray="3 2" />
              ))}

              {showPada && sky.padaBounds.map((pb, i) => {
                if (!pb.p) return null;
                const pt = toPx(pb.p);
                return <circle key={`pd${i}`} cx={pt.x} cy={pt.y} r={1.2} fill="#6b9eff" opacity="0.5" />;
              })}

              {showNakBands && sky.nakBounds.map((nb, i) => {
                if (!nb.p) return null;
                const pt = toPx(nb.p);
                return (
                  <g key={`nb${i}`}>
                    <circle cx={pt.x} cy={pt.y} r={2.2} fill="#a3c0ff" stroke="#1a2540" strokeWidth="0.8" />
                    {showLabels && (
                      <text x={pt.x + 4} y={pt.y + 10} fill="#a3c0ff" fontSize={fs(8)}
                        opacity="0.75" letterSpacing="0.02em">{nb.nak.name.slice(0, 4)}</text>
                    )}
                  </g>
                );
              })}

              {showRashi && sky.rashiBounds.map((r, i) => {
                if (!r.p) return null;
                const pt = toPx(r.p);
                return (
                  <g key={`r${i}`}>
                    <circle cx={pt.x} cy={pt.y} r={3.5} fill="#d4a850" stroke="#2a1f0a" strokeWidth="1" />
                    {showLabels && (
                      <text x={pt.x + 6} y={pt.y - 4} fill="#d4a850" fontSize={fs(10)}
                        fontStyle="italic" letterSpacing="0.05em">{r.rashi.name}</text>
                    )}
                  </g>
                );
              })}

              {showStars && showNakshatra && sky.nakStars.map((s, i) => {
                if (!s.p) return null;
                const pt = toPx(s.p);
                const r = magToRadius(s.mag);
                return (
                  <g key={`nk${i}`} style={{ cursor: 'pointer' }}
                    onClick={() => setSelected({ type: 'nakshatra', data: s })}>
                    <circle cx={pt.x} cy={pt.y} r={r + 2} fill="#f5d870" opacity="0.15" />
                    <circle cx={pt.x} cy={pt.y} r={r} fill="#f5e8b0" filter="url(#starGlow)" />
                    {showLabels && (
                      <text x={pt.x + r + 3} y={pt.y + 3} fill="#f5e8b0" fontSize={fs(9)}
                        opacity="0.85" letterSpacing="0.03em">{s.name}</text>
                    )}
                  </g>
                );
              })}

              {showStars && sky.otherStars.map((s, i) => {
                if (!s.p) return null;
                const pt = toPx(s.p);
                const r = magToRadius(s.mag);
                return (
                  <g key={`ns${i}`} style={{ cursor: 'pointer' }}
                    onClick={() => setSelected({ type: 'star', data: s })}>
                    <circle cx={pt.x} cy={pt.y} r={r} fill="#cfd6e8" filter="url(#starGlow)" />
                    {showLabels && (
                      <text x={pt.x + r + 3} y={pt.y + 3} fill="#a8b0c0" fontSize={fs(8)}
                        opacity="0.7" letterSpacing="0.02em">{s.name.split(' (')[0]}</text>
                    )}
                  </g>
                );
              })}

              {/* Tithi arc: glowing arc from Sun to Moon along the ecliptic.
                  Colour-coded by pakṣa (gold for śukla, silver for kṛṣṇa).
                  Length grows from 0° (Amāvāsyā) to 360° back to 0°. */}
              {showTithiArc && sky.tithiArc.length > 1 && (() => {
                const isShukla = sky.panchanga.tithi.paksha === 'Śukla';
                const arcColor = isShukla ? '#f5d870' : '#a8b0c0';
                const pathParts = [];
                let pathOpen = false;
                for (const pt of sky.tithiArc) {
                  if (pt.p) {
                    const px = toPx(pt.p);
                    if (!pathOpen) {
                      pathParts.push(`M ${px.x.toFixed(1)} ${px.y.toFixed(1)}`);
                      pathOpen = true;
                    } else {
                      pathParts.push(`L ${px.x.toFixed(1)} ${px.y.toFixed(1)}`);
                    }
                  } else {
                    pathOpen = false; // gap when arc passes below horizon
                  }
                }
                const d = pathParts.join(' ');
                return (
                  <g>
                    {/* Glow halo */}
                    <path d={d} fill="none" stroke={arcColor} strokeWidth="6"
                      strokeOpacity="0.12" strokeLinecap="round" />
                    {/* Main arc */}
                    <path d={d} fill="none" stroke={arcColor} strokeWidth="2.2"
                      strokeOpacity="0.7" strokeLinecap="round" />
                  </g>
                );
              })()}

              {/* Karaṇa marker: Devanagari क (ka) at the half-tithi boundary on the ecliptic.
                  Visually distinct from any planet glyph. */}
              {showTithiArc && sky.karanaNotch && (() => {
                const pt = toPx(sky.karanaNotch);
                return (
                  <g>
                    {/* Faint backing for legibility against bright stars / ecliptic */}
                    <circle cx={pt.x} cy={pt.y} r={9} fill="#1a1408" opacity="0.55" />
                    {/* Devanagari ka character */}
                    <text x={pt.x} y={pt.y + 5} textAnchor="middle"
                      fill="#f5d870" fontSize={fs(15)} fontWeight="500"
                      style={{ fontFamily: 'serif' }}>क</text>
                  </g>
                );
              })()}

              {/* Trails: rendered before planets/Lagna so they sit visually behind */}
              {showTrails && (() => {
                const trailColors = {
                  Sun: '#f5c542', Moon: '#e8e8e8', Mercury: '#9bc6e0',
                  Venus: '#fce0a0', Mars: '#e07050', Jupiter: '#e8b870',
                  Saturn: '#7a8090', Rahu: '#7a5cff', Ketu: '#a07a4f',
                  Lagna: '#ff6b3d',
                };
                const out = [];
                for (const [key, points] of Object.entries(trailsRef.current)) {
                  if (!points || points.length < 2) continue;
                  const color = trailColors[key] || '#888';
                  for (let i = 1; i < points.length; i++) {
                    const a = toPx(points[i - 1]);
                    const b = toPx(points[i]);
                    const opacity = (i / points.length) * 0.6;
                    out.push(
                      <line key={`tr-${key}-${i}`}
                        x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                        stroke={color} strokeWidth={1.2} strokeOpacity={opacity}
                        strokeLinecap="round" />
                    );
                  }
                }
                return out;
              })()}

              {sky.ascProj.p && (() => {
                const pt = toPx(sky.ascProj.p);
                return (
                  <g style={{ cursor: 'pointer' }} onClick={() => setSelected({ type: 'lagna' })}>
                    <circle cx={pt.x} cy={pt.y} r={10} fill="none" stroke="#ff6b3d" strokeWidth="1.5" />
                    <circle cx={pt.x} cy={pt.y} r={4} fill="#ff6b3d" />
                    <text x={pt.x + 14} y={pt.y + 4} fill="#ff6b3d" fontSize={fs(12)}
                      fontWeight="600" letterSpacing="0.1em">LAGNA</text>
                  </g>
                );
              })()}

              {sky.planets.map((pl, i) => {
                if (!pl.p) return null;
                const pt = toPx(pl.p);
                // Sun is rendered 1.5× larger than the other grahas to reflect its visual
                // dominance and prevent confusion with smaller planets like Mercury and Venus.
                const sizeMult = pl.key === 'Sun' ? 1.5 : 1;
                const haloR = 9 * sizeMult;
                const discR = 5 * sizeMult;
                const labelOffset = 9 * sizeMult;
                return (
                  <g key={i} style={{ cursor: 'pointer' }}
                    onClick={() => setSelected({ type: 'planet', data: pl })}>
                    <circle cx={pt.x} cy={pt.y} r={haloR} fill={pl.color} opacity="0.25" />
                    <circle cx={pt.x} cy={pt.y} r={discR} fill={pl.color} stroke="#1a1408" strokeWidth="1" />
                    <text x={pt.x + labelOffset} y={pt.y + 4} fill={pl.color} fontSize={fs(13)} fontWeight="600">{pl.label}</text>
                    {pl.retrograde && (
                      <text x={pt.x + labelOffset} y={pt.y + 16} fill={pl.color} fontSize={fs(9)}
                        opacity="0.85" fontStyle="italic">℞</text>
                    )}
                  </g>
                );
              })}

              {sky.nodes.map((nd, i) => {
                if (!nd.p) return null;
                const pt = toPx(nd.p);
                return (
                  <g key={`nd${i}`} style={{ cursor: 'pointer' }}
                    onClick={() => setSelected({ type: 'planet', data: nd })}>
                    <circle cx={pt.x} cy={pt.y} r={9} fill={nd.color} opacity="0.25" />
                    <circle cx={pt.x} cy={pt.y} r={5} fill={nd.color} stroke="#1a1408" strokeWidth="1" />
                    <text x={pt.x + 9} y={pt.y + 4} fill={nd.color} fontSize={fs(13)} fontWeight="600">{nd.label}</text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Panel title="Time">
              <div style={{ fontSize: 13, color: '#f0e4c2', marginBottom: 8, fontVariantNumeric: 'tabular-nums' }}>
                {now.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'medium' })}
              </div>

              {/* Play / pause / now */}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                <Btn onClick={() => setPlaying(p => !p)} primary>
                  {playing ? '⏸ Pause' : '▶ Play'}
                </Btn>
                <Btn onClick={reset}>● Now</Btn>
                <Btn onClick={() => setShowTrails(t => !t)} active={showTrails}>
                  Trails
                </Btn>
              </div>

              {/* Speed presets */}
              <div style={{ fontSize: 9, color: '#8a7a5a', letterSpacing: '0.15em',
                textTransform: 'uppercase', marginTop: 6, marginBottom: 4 }}>Speed</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {SPEED_PRESETS.map(s => (
                  <Btn key={s.value} onClick={() => setSpeed(s.value)}
                    active={speedMultiplier === s.value}>{s.label}</Btn>
                ))}
              </div>

              {/* Manual step (only useful when paused) */}
              <div style={{ fontSize: 9, color: '#8a7a5a', letterSpacing: '0.15em',
                textTransform: 'uppercase', marginTop: 10, marginBottom: 4 }}>Step</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <Btn onClick={() => shiftTime(-1)}>−1h</Btn>
                <Btn onClick={() => shiftTime(-1/6)}>−10m</Btn>
                <Btn onClick={() => shiftTime(1/6)}>+10m</Btn>
                <Btn onClick={() => shiftTime(1)}>+1h</Btn>
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                <Btn onClick={() => shiftTime(-24)}>−1d</Btn>
                <Btn onClick={() => shiftTime(24)}>+1d</Btn>
                <Btn onClick={() => shiftTime(-24*30)}>−1mo</Btn>
                <Btn onClick={() => shiftTime(24*30)}>+1mo</Btn>
                <Btn onClick={() => shiftTime(-24*365)}>−1y</Btn>
                <Btn onClick={() => shiftTime(24*365)}>+1y</Btn>
              </div>
            </Panel>

            <Panel title="Location">
              <div style={{ fontSize: 13, color: '#f0e4c2', marginBottom: 8 }}>
                {locName} · {lat.toFixed(2)}°, {lon.toFixed(2)}°
              </div>

              {/* Search box + "use my location" */}
              <div style={{ position: 'relative', marginBottom: 8 }}>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search city…"
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    background: 'rgba(184, 149, 106, 0.08)',
                    border: '1px solid rgba(184, 149, 106, 0.3)',
                    borderRadius: 4,
                    color: '#e8e0c8',
                    fontFamily: 'inherit',
                    fontSize: 13,
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
                {searchResults.length > 0 && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    marginTop: 2,
                    background: 'rgba(20, 14, 8, 0.97)',
                    border: '1px solid rgba(184, 149, 106, 0.4)',
                    borderRadius: 4,
                    zIndex: 10,
                    maxHeight: 200,
                    overflowY: 'auto',
                  }}>
                    {searchResults.map((r, i) => (
                      <div key={i} onClick={() => pickResult(r)} style={{
                        padding: '6px 8px',
                        fontSize: 12,
                        cursor: 'pointer',
                        borderBottom: i < searchResults.length - 1 ? '1px solid rgba(184, 149, 106, 0.1)' : 'none',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(212, 168, 80, 0.15)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <div style={{ color: '#f0e4c2' }}>
                          {r.name}{r.admin1 && r.admin1 !== r.name ? `, ${r.admin1}` : ''}{r.country_code ? `, ${r.country_code}` : ''}
                        </div>
                        <div style={{ color: '#8a7a5a', fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
                          {r.latitude.toFixed(2)}°, {r.longitude.toFixed(2)}°
                          {r.population ? ` · pop. ${(r.population/1000).toFixed(0)}k` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {searching && (
                <div style={{ fontSize: 10, color: '#8a7a5a', marginBottom: 6 }}>Searching…</div>
              )}
              {searchError && (
                <div style={{ fontSize: 10, color: '#e07050', marginBottom: 6 }}>{searchError}</div>
              )}

              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                <Btn onClick={useMyLocation}>📍 My location</Btn>
              </div>

              <div style={{ fontSize: 9, color: '#8a7a5a', letterSpacing: '0.15em',
                textTransform: 'uppercase', marginTop: 6, marginBottom: 4 }}>Favourites</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {PRESETS.map(p => (
                  <Btn key={p.name} onClick={() => { setLat(p.lat); setLon(p.lon); setLocName(p.name); }}
                    active={p.name === locName}>{p.name}</Btn>
                ))}
              </div>
            </Panel>

            <Panel title="Display">
              <Toggle on={showRashi} onChange={setShowRashi} label="Rāśi boundaries" />
              <Toggle on={showNakBands} onChange={setShowNakBands} label="Nakṣatra boundaries" />
              <Toggle on={showPada} onChange={setShowPada} label="Pāda ticks" />
              <Toggle on={showNakshatra} onChange={setShowNakshatra} label="Nakṣatra stars" />
              <Toggle on={showStars} onChange={setShowStars} label="Named stars" />
              <Toggle on={showTithiArc} onChange={setShowTithiArc} label="Tithi arc" />
              <Toggle on={showLabels} onChange={setShowLabels} label="Labels" />

              <div style={{ fontSize: 9, color: '#8a7a5a', letterSpacing: '0.15em',
                textTransform: 'uppercase', marginTop: 10, marginBottom: 4 }}>Label size</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <Btn onClick={() => setLabelSize('small')} active={labelSize === 'small'}>Small</Btn>
                <Btn onClick={() => setLabelSize('medium')} active={labelSize === 'medium'}>Medium</Btn>
                <Btn onClick={() => setLabelSize('large')} active={labelSize === 'large'}>Large</Btn>
              </div>
            </Panel>

            {selected && <SelectedInfo selected={selected} sky={sky}
              rashiOf={rashiOf} nakshatraOf={nakshatraOf} fmtDeg={fmtDeg}
              onClose={() => setSelected(null)} />}
          </div>
        </div>

        <div style={{ marginTop: 16, padding: 12, background: 'rgba(8, 10, 24, 0.6)',
          border: '1px solid rgba(184, 149, 106, 0.2)', borderRadius: 8,
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12, fontSize: 12 }}>
          <InfoCell label="Lagna" color="#ff6b3d" value={(() => {
            const r = rashiOf(sky.ascSid), n = nakshatraOf(sky.ascSid);
            return `${r.rashi.name} ${fmtDeg(r.deg)} · ${n.nak.name} pāda ${n.pada}`;
          })()} />
          {sky.planets.filter(p => ['Sun', 'Moon', 'Jupiter'].includes(p.key)).map(p => (
            <InfoCell key={p.key} label={`${p.label} ${p.name}`} color={p.color} value={(() => {
              const r = rashiOf(p.sidLon), n = nakshatraOf(p.sidLon);
              return `${r.rashi.name} ${fmtDeg(r.deg)} · ${n.nak.name}${p.retrograde ? ' ℞' : ''}`;
            })()} />
          ))}
          <InfoCell label="Ayanāṃśa" color="#b8956a" value={fmtDeg(sky.ayan) + ' (Lahiri)'} />
        </div>

        {/* Pañcāṅga status panel - the five limbs of the traditional calendar */}
        <div style={{ marginTop: 12, padding: 12, background: 'rgba(20, 14, 8, 0.55)',
          border: '1px solid rgba(245, 216, 112, 0.25)', borderRadius: 8 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.25em', color: '#d4a850',
            textTransform: 'uppercase', marginBottom: 10, textAlign: 'center' }}>
            Pañcāṅga
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 12, fontSize: 12,
          }}>
            <PanchangaCell label="Tithi"
              primary={`${sky.panchanga.tithi.name} (${sky.panchanga.tithi.number})`}
              secondary={`${sky.panchanga.tithi.paksha} pakṣa`}
              tertiary={`${(sky.panchanga.tithi.progress * 100).toFixed(0)}% complete`}
              color={sky.panchanga.tithi.paksha === 'Śukla' ? '#f5d870' : '#a8b0c0'} />
            <PanchangaCell label="Yoga"
              primary={`${sky.panchanga.yoga.name} (${sky.panchanga.yoga.number})`}
              secondary={`${YOGA_QUALITY[sky.panchanga.yoga.name] || ''}`}
              color="#9bc6e0" />
            <PanchangaCell label="Karaṇa"
              primary={`${sky.panchanga.karana.name} (${sky.panchanga.karana.position})`}
              secondary={sky.panchanga.karana.name === 'Viṣṭi' ? 'aka Bhadrā (avoid)' :
                FIXED_KARANAS[sky.panchanga.karana.position] ? 'sthira (fixed)' : 'cara (movable)'}
              tertiary={sky.panchanga.karana.half === 0 ? 'first half of tithi' : 'second half of tithi'}
              color="#fce0a0" />
            <PanchangaCell label="Vāra"
              primary={sky.panchanga.vara.name}
              secondary={`day of ${sky.panchanga.vara.planet}`}
              color="#e8b870" />
            <PanchangaCell label="Nakṣatra (Moon)"
              primary={(() => {
                const moon = sky.planets.find(p => p.key === 'Moon');
                const n = nakshatraOf(moon.sidLon);
                return `${n.nak.name} (${n.nak.n}), pāda ${n.pada}`;
              })()}
              secondary={(() => {
                const moon = sky.planets.find(p => p.key === 'Moon');
                const n = nakshatraOf(moon.sidLon);
                return `lord: ${n.nak.lord}`;
              })()}
              color="#e8e8e8" />
          </div>
        </div>

        <div style={{ marginTop: 12, fontSize: 10, color: '#5a5040', textAlign: 'center', letterSpacing: '0.05em' }}>
          Planet positions via astronomy-engine VSOP87 (~1 arcmin) · Mean lunar node · © 2026 Mahesh Ramanan, MIT
          · ℞ = retrograde
        </div>
      </div>
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div style={{ background: 'rgba(8, 10, 24, 0.6)',
      border: '1px solid rgba(184, 149, 106, 0.2)', borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 10, letterSpacing: '0.2em', color: '#b8956a',
        textTransform: 'uppercase', marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function Btn({ children, onClick, primary, active }) {
  const bg = primary ? '#d4a850' : active ? 'rgba(212, 168, 80, 0.25)' : 'rgba(184, 149, 106, 0.1)';
  const color = primary ? '#1a1408' : '#e8e0c8';
  const border = primary ? '#d4a850' : 'rgba(184, 149, 106, 0.3)';
  return (
    <button onClick={onClick} style={{ background: bg, color, border: `1px solid ${border}`,
      borderRadius: 4, padding: '4px 8px', fontSize: 11, cursor: 'pointer',
      fontFamily: 'inherit', letterSpacing: '0.05em' }}>{children}</button>
  );
}

function Toggle({ on, onChange, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
      cursor: 'pointer', fontSize: 12 }} onClick={() => onChange(!on)}>
      <div style={{ width: 28, height: 16, borderRadius: 8,
        background: on ? '#d4a850' : 'rgba(184, 149, 106, 0.2)',
        position: 'relative', transition: 'all 0.2s' }}>
        <div style={{ position: 'absolute', top: 2, left: on ? 14 : 2,
          width: 12, height: 12, borderRadius: '50%',
          background: on ? '#1a1408' : '#8a7a5a', transition: 'all 0.2s' }} />
      </div>
      <span style={{ color: '#e8e0c8' }}>{label}</span>
    </div>
  );
}

function InfoCell({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 9, letterSpacing: '0.2em', color: '#8a7a5a',
        textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
      <div style={{ color, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function PanchangaCell({ label, primary, secondary, tertiary, color }) {
  return (
    <div>
      <div style={{ fontSize: 9, letterSpacing: '0.2em', color: '#8a7a5a',
        textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
      <div style={{ color, fontSize: 13, fontWeight: 500, marginBottom: 1 }}>{primary}</div>
      {secondary && (
        <div style={{ color: '#a09080', fontSize: 10, fontStyle: 'italic' }}>{secondary}</div>
      )}
      {tertiary && (
        <div style={{ color: '#705f48', fontSize: 9 }}>{tertiary}</div>
      )}
    </div>
  );
}

function SelectedInfo({ selected, sky, rashiOf, nakshatraOf, fmtDeg, onClose }) {
  let title = '', rows = [];
  if (selected.type === 'lagna') {
    title = 'Lagna · Ascendant';
    const r = rashiOf(sky.ascSid), n = nakshatraOf(sky.ascSid);
    rows = [
      ['Sidereal longitude', fmtDeg(sky.ascSid)],
      ['Rāśi', `${r.rashi.name} (${r.rashi.en}) ${fmtDeg(r.deg)}`],
      ['Nakṣatra', `${n.nak.name}, pāda ${n.pada}`],
      ['Altitude', fmtDeg(sky.ascProj.alt)],
      ['Azimuth', fmtDeg(sky.ascProj.az)],
    ];
  } else if (selected.type === 'planet') {
    const pl = selected.data;
    title = `${pl.name} (${pl.key})`;
    const r = rashiOf(pl.sidLon), n = nakshatraOf(pl.sidLon);
    rows = [
      ['Sidereal longitude', fmtDeg(pl.sidLon)],
      ['Rāśi', `${r.rashi.name} ${fmtDeg(r.deg)}`],
      ['Nakṣatra', `${n.nak.name}, pāda ${n.pada}`],
      ['Ecliptic latitude', fmtDeg(Math.abs(pl.eclLat || 0)) + (pl.eclLat < 0 ? ' S' : ' N')],
      ['Altitude', fmtDeg(pl.alt)],
      ['Azimuth', fmtDeg(pl.az)],
    ];
    if (pl.motion !== undefined && pl.key !== 'Sun' && pl.key !== 'Moon' && pl.key !== 'Rahu' && pl.key !== 'Ketu') {
      rows.push(['Daily motion', `${pl.motion.toFixed(3)}°/day${pl.retrograde ? ' (retrograde)' : ''}`]);
    }
  } else if (selected.type === 'nakshatra') {
    const s = selected.data;
    title = `${s.name} · ${s.tamil}`;
    rows = [
      ['Yogatārā', s.star],
      ['Nakṣatra lord', s.lord],
      ['Magnitude', s.mag.toFixed(2)],
      ['RA (J2000)', fmtDeg(s.ra)],
      ['Dec (J2000)', fmtDeg(s.dec)],
      ['Altitude', fmtDeg(s.alt)],
    ];
  } else if (selected.type === 'star') {
    const s = selected.data;
    title = s.name;
    rows = [
      ['Star', s.star],
      ['Magnitude', s.mag.toFixed(2)],
      ['RA (J2000)', fmtDeg(s.ra)],
      ['Dec (J2000)', fmtDeg(s.dec)],
      ['Altitude', fmtDeg(s.alt)],
      ['Azimuth', fmtDeg(s.az)],
    ];
  }
  return (
    <div style={{ background: 'rgba(20, 14, 8, 0.85)',
      border: '1px solid rgba(212, 168, 80, 0.4)', borderRadius: 8, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 13, color: '#f0e4c2', fontWeight: 500, letterSpacing: '0.02em' }}>{title}</div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#8a7a5a',
          cursor: 'pointer', fontSize: 16, padding: 0, lineHeight: 1 }}>×</button>
      </div>
      <div style={{ fontSize: 11 }}>
        {rows.map(([k, v], i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between',
            padding: '3px 0', borderBottom: i < rows.length - 1 ? '1px solid rgba(184, 149, 106, 0.1)' : 'none' }}>
            <span style={{ color: '#8a7a5a' }}>{k}</span>
            <span style={{ color: '#e8e0c8', fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
