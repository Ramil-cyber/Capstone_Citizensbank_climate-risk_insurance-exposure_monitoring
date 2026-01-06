/* global L, chroma, APP_CONFIG */
const INITIAL_VIEW = { center: [39.5, -98.35], zoom: 4 };

const state = {
  year: APP_CONFIG.years[0],
  hpiValues: {},
  min: 0,
  max: 1,
  countiesLayer: null,
  countiesIndex: new Map(), // fips -> layer
  playTimer: null,
  selectedFips: null,
  countyNameIndex: [], // array of { fips, county, state }
};

const els = {
  yearValue: document.getElementById("yearValue"),
  slider: document.getElementById("yearSlider"),
  prev: document.getElementById("prevYear"),
  next: document.getElementById("nextYear"),
  play: document.getElementById("play"),

  zipInput: document.getElementById("zipInput"),
  zipGo: document.getElementById("zipGo"),
  zipStatus: document.getElementById("zipStatus"),

  hoverCard: document.getElementById("hoverCard"),
  hoverName: document.getElementById("hoverName"),
  hoverFips: document.getElementById("hoverFips"),
  hoverHpi: document.getElementById("hoverHpi"),

  legendRange: document.getElementById("legendRange"),
  legendMin: document.getElementById("legendMin"),
  legendMax: document.getElementById("legendMax"),
  resetView: document.getElementById("resetView"),
  legendBar: document.getElementById("legendBar"),

  countyInput: document.getElementById("countyInput"),
  countyGo: document.getElementById("countyGo"),
  countyStatus: document.getElementById("countyStatus"),      
};

const map = L.map("map", { zoomSnap: 0.25, zoomControl: true })
  .setView(INITIAL_VIEW.center, INITIAL_VIEW.zoom);

els.resetView.addEventListener("click", () => {
  state.selectedFips = null;
  refreshLayerStyles();
  map.setView(INITIAL_VIEW.center, INITIAL_VIEW.zoom);
});

els.countyGo.addEventListener("click", countyZoom);
els.countyInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") countyZoom();
});

async function fetchCountySeries(fips) {
  const res = await fetch(`/api/county_series/${encodeURIComponent(fips)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to load county series");
  return data;
}

function popupHtml({ county, state, fips, series }) {
  const title = `${county || "County"}${state ? ", " + state : ""}`;
  const rows = Object.entries(series || {})
    .map(([year, val]) => `<tr><td>${year}</td><td>${formatNumber(val)}</td></tr>`)
    .join("");

  return `
    <div class="county-popup">
      <div class="title">${title}</div>
      <div style="font-size:12px; opacity:.8; margin-bottom:6px;">FIPS: ${fips}</div>
      <table>${rows}</table>
    </div>
  `;
}


L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

// Color scale (nice perceptual ramp)
function makeScale(min, max) {
  // clamp range if weird
  const lo = Number.isFinite(min) ? min : 0;
  const hi = Number.isFinite(max) && max > lo ? max : lo + 1;
  return chroma.scale(["#102a43", "#2f855a", "#f6ad55", "#c53030"]).domain([lo, hi]).mode("lab");
}

function getFipsFromFeature(feature) {
  const p = feature.properties || {};
  const f = (
    feature.id ||        // needed for the provided GeoJSON
    p.GEOID ||
    p.FIPS ||
    p.fips ||
    ""
  ).toString();
  return f.padStart(5, "0");
}

function formatNumber(x) {
  if (x === null || x === undefined) return "—";
  if (!Number.isFinite(x)) return "—";
  return x.toFixed(1);
}

function styleFor(feature) {
  const fips = getFipsFromFeature(feature);
  const v = state.hpiValues[fips];
  const scale = makeScale(state.min, state.max);

  const has = Number.isFinite(v);
  const fill = has ? scale(v).hex() : "#1f2937";

  const isSelected = state.selectedFips === fips;

  return {
    weight: isSelected ? 2.5 : 0.6,
    opacity: 1,
    color: isSelected ? "#e5e7eb" : "rgba(255,255,255,0.35)",
    fillOpacity: has ? 0.88 : 0.20,
    fillColor: fill
  };
}

function updateLegend() {
  els.legendMin.textContent = formatNumber(state.min);
  els.legendMax.textContent = formatNumber(state.max);
  els.legendRange.textContent = `(${formatNumber(state.min)} → ${formatNumber(state.max)})`;

  const scale = makeScale(state.min, state.max);
  const steps = 16;
  els.legendBar.innerHTML = "";

  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const v = state.min + t * (state.max - state.min);
    const swatch = document.createElement("div");
    swatch.className = "swatch";
    swatch.style.background = scale(v).hex();
    els.legendBar.appendChild(swatch);
  }
}

async function fetchHpi(year) {
  const url = `${APP_CONFIG.apiHpiUrl}?year=${encodeURIComponent(year)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load HPI data");
  return await res.json();
}

function refreshLayerStyles() {
  if (!state.countiesLayer) return;
  state.countiesLayer.setStyle(styleFor);
}

function bindFeatureEvents(feature, layer) {
  const fips = getFipsFromFeature(feature);
  state.countiesIndex.set(fips, layer);

  let popupLoaded = false;

  // ---------- HOVER: show popup ----------
  layer.on("mouseover", async () => {
    layer.setStyle({ weight: 2 });

    if (!popupLoaded) {
      try {
        const series = await fetchCountySeries(fips);

        const props = feature.properties || {};
        const countyName =
          series.county ||
          props.NAME ||
          props.name ||
          "County";

        const stateName =
          series.state ||
          props.STATE ||
          props.state ||
          "";

        const html = popupHtml({
          county: countyName,
          state: stateName,
          fips,
          series: series.series
        });

        layer.bindPopup(html, {
          closeButton: false,
          autoPan: false,
          offset: [0, -4],
          className: "county-hover-popup"
        });

        popupLoaded = true;
      } catch (e) {
        layer.bindPopup(
          `<div style="font-size:12px;">${e.message}</div>`,
          { closeButton: false }
        );
      }
    }

    layer.openPopup();
  });

  // ---------- MOUSE OUT: hide popup ----------
  layer.on("mouseout", () => {
    layer.setStyle(styleFor(feature));
    layer.closePopup();
  });

  // ---------- CLICK: zoom + highlight ----------
  layer.on("click", () => {
    state.selectedFips = fips;
    refreshLayerStyles();

    const bounds = layer.getBounds();
    map.fitBounds(bounds.pad(0.15));
  });
  }

 


async function loadCounties() {
  const res = await fetch(APP_CONFIG.countiesGeojsonUrl);
  if (!res.ok) throw new Error("Failed to load counties GeoJSON");
  const geo = await res.json();

  state.countiesLayer = L.geoJSON(geo, {
    style: styleFor,
    onEachFeature: (feature, layer) => bindFeatureEvents(feature, layer)
  }).addTo(map);
}

async function setYear(year) {
  state.year = year;
  els.yearValue.textContent = year;
  els.slider.value = year;

  const data = await fetchHpi(year);
  state.hpiValues = data.values || {};
  state.min = data.min;
  state.max = data.max;

  updateLegend();
  refreshLayerStyles();
}

function stepYear(delta) {
  const idx = APP_CONFIG.years.indexOf(state.year);
  const nextIdx = Math.min(APP_CONFIG.years.length - 1, Math.max(0, idx + delta));
  const nextYear = APP_CONFIG.years[nextIdx];
  setYear(nextYear).catch(console.error);
}

function togglePlay() {
  if (state.playTimer) {
    clearInterval(state.playTimer);
    state.playTimer = null;
    els.play.textContent = "Play";
    return;
  }

  els.play.textContent = "Pause";
  state.playTimer = setInterval(() => {
    const idx = APP_CONFIG.years.indexOf(state.year);
    const nextIdx = (idx + 1) % APP_CONFIG.years.length;
    setYear(APP_CONFIG.years[nextIdx]).catch(console.error);
  }, 1200);
}

async function zipZoom() {
  const zip = (els.zipInput.value || "").trim();
  els.zipStatus.textContent = "";
  els.zipStatus.className = "status";

  if (!/^\d{5}(\d{4})?$/.test(zip)) {
    els.zipStatus.textContent = "Enter a valid 5-digit ZIP (or 9 digits without hyphen).";
    els.zipStatus.classList.add("bad");
    return;
  }

  els.zipStatus.textContent = "Looking up ZIP…";
  els.zipStatus.classList.add("muted");

  try {
    const res = await fetch(APP_CONFIG.apiZipUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zip })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "ZIP lookup failed");

    const fips = data.county_fips;
    const layer = state.countiesIndex.get(fips);

    if (!layer) {
      throw new Error(`County FIPS ${fips} not found in GeoJSON.`);
    }

    state.selectedFips = fips;
    refreshLayerStyles();

    const bounds = layer.getBounds();
    map.fitBounds(bounds.pad(0.12));

    els.zipStatus.textContent = `Zoomed to ${data.county_name || "county"} (FIPS ${fips}).`;
    els.zipStatus.className = "status ok";
  } catch (e) {
    els.zipStatus.textContent = e.message;
    els.zipStatus.className = "status bad";
  }
}

function parseCountyQuery(q) {
  const s = (q || "").trim();
  if (!s) return { county: "", state: "" };

  // allow: "Wake, NC" or "Wake NC"
  const parts = s.includes(",")
    ? s.split(",").map(x => x.trim())
    : s.split(/\s+/);

  if (parts.length >= 2) {
    const state = parts[parts.length - 1];
    const county = s.replace(state, "").replace(",", "").trim();
    return { county: county.toLowerCase(), state: state.toLowerCase() };
  }
  return { county: s.toLowerCase(), state: "" };
}

function findCountyFips(query) {
  const { county, state } = parseCountyQuery(query);
  if (!county) return null;

  // exact match preference
  let hit = state.countyNameIndex.find(x => x.county === county && (!state || x.state === state));
  if (hit) return hit.fips;

  // contains match fallback
  hit = state.countyNameIndex.find(x => x.county.includes(county) && (!state || x.state === state));
  return hit ? hit.fips : null;
}

async function countyZoom() {
  const q = (els.countyInput.value || "").trim();
  els.countyStatus.textContent = "";
  els.countyStatus.className = "status";

  const fips = findCountyFips(q);
  if (!fips) {
    els.countyStatus.textContent = "County not found. Try: “Wake, NC”.";
    els.countyStatus.className = "status bad";
    return;
  }

  const layer = state.countiesIndex.get(fips);
  if (!layer) {
    els.countyStatus.textContent = `Found FIPS ${fips}, but county shape not loaded.`;
    els.countyStatus.className = "status bad";
    return;
  }

  state.selectedFips = fips;
  refreshLayerStyles();

  const bounds = layer.getBounds();
  map.fitBounds(bounds.pad(0.12));

  // also open the same popup as click
  layer.fire("click");

  els.countyStatus.textContent = `Zoomed to county (FIPS ${fips}).`;
  els.countyStatus.className = "status ok";
}

/* UI bindings */
els.slider.addEventListener("input", (e) => {
  const y = Number(e.target.value);
  setYear(y).catch(console.error);
});

els.prev.addEventListener("click", () => stepYear(-1));
els.next.addEventListener("click", () => stepYear(1));
els.play.addEventListener("click", togglePlay);

els.zipGo.addEventListener("click", zipZoom);
els.zipInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") zipZoom();
});

/* Boot */
(async function init() {
  try {
    await loadCounties();
    await setYear(state.year);
  } catch (e) {
    console.error(e);
    alert(e.message);
  }
})();