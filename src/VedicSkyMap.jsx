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
// MAIN COMPONENT
// =============================================================================

export default function Ayanamsha() {
  const [now, setNow] = useState(new Date());
  const [live, setLive] = useState(true);
  const [lat, setLat] = useState(-27.4698);
  const [lon, setLon] = useState(153.0251);
  const [locName, setLocName] = useState('Brisbane');
  const [showRashi, setShowRashi] = useState(true);
  const [showNakshatra, setShowNakshatra] = useState(true);
  const [showNakBands, setShowNakBands] = useState(false);
  const [showPada, setShowPada] = useState(false);
  const [showStars, setShowStars] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [selected, setSelected] = useState(null);
  const [size, setSize] = useState(640);

  const containerRef = useRef(null);

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

  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, [live]);

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

    return {
      jd, ayan, eps, lst, gmst,
      planets, nodes, ascSid, ascTrop, ascProj,
      ecliptic, nakStars, otherStars,
      rashiBounds, nakBounds, padaBounds,
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
    setLive(false);
    setNow(new Date(now.getTime() + hours * 3600 * 1000));
  }
  function reset() { setLive(true); setNow(new Date()); }

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
            Ayanamsha</h1>
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

              <text x={northPt.x} y={northPt.y - 8} textAnchor="middle" fill="#b8956a" fontSize="11" letterSpacing="0.15em">N</text>
              <text x={southPt.x} y={southPt.y + 18} textAnchor="middle" fill="#b8956a" fontSize="11" letterSpacing="0.15em">S</text>
              <text x={eastPt.x - 10} y={eastPt.y + 4} textAnchor="end" fill="#d4a850" fontSize="12" letterSpacing="0.15em" fontWeight="500">E</text>
              <text x={westPt.x + 10} y={westPt.y + 4} textAnchor="start" fill="#b8956a" fontSize="11" letterSpacing="0.15em">W</text>

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
                      <text x={pt.x + 4} y={pt.y + 10} fill="#a3c0ff" fontSize="8"
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
                      <text x={pt.x + 6} y={pt.y - 4} fill="#d4a850" fontSize="10"
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
                      <text x={pt.x + r + 3} y={pt.y + 3} fill="#f5e8b0" fontSize="9"
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
                      <text x={pt.x + r + 3} y={pt.y + 3} fill="#a8b0c0" fontSize="8"
                        opacity="0.7" letterSpacing="0.02em">{s.name.split(' (')[0]}</text>
                    )}
                  </g>
                );
              })}

              {sky.ascProj.p && (() => {
                const pt = toPx(sky.ascProj.p);
                return (
                  <g style={{ cursor: 'pointer' }} onClick={() => setSelected({ type: 'lagna' })}>
                    <circle cx={pt.x} cy={pt.y} r={10} fill="none" stroke="#ff6b3d" strokeWidth="1.5" />
                    <circle cx={pt.x} cy={pt.y} r={4} fill="#ff6b3d" />
                    <text x={pt.x + 14} y={pt.y + 4} fill="#ff6b3d" fontSize="12"
                      fontWeight="600" letterSpacing="0.1em">LAGNA</text>
                  </g>
                );
              })()}

              {sky.planets.map((pl, i) => {
                if (!pl.p) return null;
                const pt = toPx(pl.p);
                return (
                  <g key={i} style={{ cursor: 'pointer' }}
                    onClick={() => setSelected({ type: 'planet', data: pl })}>
                    <circle cx={pt.x} cy={pt.y} r={9} fill={pl.color} opacity="0.25" />
                    <circle cx={pt.x} cy={pt.y} r={5} fill={pl.color} stroke="#1a1408" strokeWidth="1" />
                    <text x={pt.x + 9} y={pt.y + 4} fill={pl.color} fontSize="13" fontWeight="600">{pl.label}</text>
                    {pl.retrograde && (
                      <text x={pt.x + 9} y={pt.y + 16} fill={pl.color} fontSize="9"
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
                    <text x={pt.x + 9} y={pt.y + 4} fill={nd.color} fontSize="13" fontWeight="600">{nd.label}</text>
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
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <Btn onClick={() => shiftTime(-1)}>−1h</Btn>
                <Btn onClick={() => shiftTime(-1/6)}>−10m</Btn>
                <Btn onClick={reset} primary>{live ? '● Live' : 'Now'}</Btn>
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
              <Toggle on={showLabels} onChange={setShowLabels} label="Labels" />
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
