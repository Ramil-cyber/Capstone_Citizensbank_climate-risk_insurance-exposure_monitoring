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

state.mapMode = "states";      // "states" or "counties"
state.selectedState = null;    // "01", "37", etc.

state.statesLayer = null;
state.stateValues = {};
state.stateMin = 0;
state.stateMax = 1;

state.stateLabelLayer = null;

const COUNTY_LABEL_ZOOM = 7;

state.countyLabelLayer = null;
state._labelRaf = null;


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

  backToStates: document.getElementById("backToStates"),
};

const map = L.map("map", { zoomSnap: 0.25, zoomControl: true })
  .setView(INITIAL_VIEW.center, INITIAL_VIEW.zoom);

els.resetView.addEventListener("click", () => {
  state.selectedFips = null;
  refreshLayerStyles();
  map.setView(INITIAL_VIEW.center, INITIAL_VIEW.zoom);

  if (state.countiesLayer) {
    map.removeLayer(state.countiesLayer);
    state.countiesLayer = null;
    state.countiesIndex = new Map();
  }
  clearCountyLabels();
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

  // Always load state averages for legend scaling (and state mode)
    const st = await fetchStateHpi(year);
    state.stateValues = st.values || {};
    state.stateMin = st.min;
    state.stateMax = st.max;

    if (state.mapMode === "states") {
    updateLegend(); // you can choose to show state min/max instead, if you want
    if (state.statesLayer) state.statesLayer.setStyle(styleState);
    } else {
    updateLegend();
    refreshLayerStyles();
    }

  const data = await fetchHpi(year);
  state.hpiValues = data.values || {};
  state.min = data.min;
  state.max = data.max;

  updateLegend();
  refreshLayerStyles();

  // Always update states (they are always visible)
    if (state.statesLayer) {
    state.statesLayer.setStyle(styleState);
    }

    // Update counties overlay if it exists
    if (state.countiesLayer) {
    refreshLayerStyles();
    }

    // Legend auto-switch
    if (state.countiesLayer) {
    updateLegend(state.min, state.max, "County HPI");
    } else {
    updateLegend(state.stateMin, state.stateMax, "State avg HPI");
    }
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
    //await loadCounties();
    await setYear(state.year);

    await loadStates();     // default view
    await setYear(state.year);
    showBackButton(false);
  } catch (e) {
    console.error(e);
    alert(e.message);
  }
})();

function getStateFips(feature) {
  const p = feature.properties || {};
  const f = (feature.id || p.STATEFP || p.GEOID || "").toString();
  return f.padStart(2, "0").slice(0, 2);
}

async function fetchStateHpi(year) {
  const res = await fetch(`${APP_CONFIG.apiStateHpiUrl}?year=${encodeURIComponent(year)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to load state averages");
  return data;
}

function makeStateScale(min, max) {
  const lo = Number.isFinite(min) ? min : 0;
  const hi = Number.isFinite(max) && max > lo ? max : lo + 1;
  return chroma.scale(["#102a43", "#2f855a", "#f6ad55", "#c53030"]).domain([lo, hi]).mode("lab");
}

function styleState(feature) {
  const st = getStateFips(feature);
  const v = state.stateValues[st];
  const scale = makeStateScale(state.stateMin, state.stateMax);

  const has = Number.isFinite(v);
  return {
    weight: 1,
    opacity: 1,
    color: "rgba(255,255,255,0.45)",
    fillOpacity: has ? 0.88 : 0.20,
    fillColor: has ? scale(v).hex() : "#1f2937"
  };
}

async function loadStates() {
  const res = await fetch(APP_CONFIG.statesGeojsonUrl);
  if (!res.ok) throw new Error("Failed to load states GeoJSON");
  const geo = await res.json();

  state.statesLayer = L.geoJSON(geo, {
    style: styleState,
    onEachFeature: (feature, layer) => {
      layer.on("mouseover", () => layer.setStyle({ weight: 2 }));
      layer.on("mouseout", () => layer.setStyle(styleState(feature)));

    layer.on("click", () => {
    const st = getStateFips(feature);
    drillToState(st, layer.getBounds());
    });
    }
  }).addTo(map);

  // ----- STATE LABELS -----
    state.stateLabelLayer = L.layerGroup();

    state.statesLayer.eachLayer(layer => {
    const feature = layer.feature;
    const name = getStateName(feature);
    const center = getFeatureCenter(layer);

    const label = L.marker(center, {
        icon: L.divIcon({
        className: "state-label",
        html: name,
        iconSize: [100, 24]
        }),
        interactive: false
    });

    state.stateLabelLayer.addLayer(label);
    });

    // show labels by default (state view)
    state.stateLabelLayer.addTo(map);
}

function showBackButton(show) {
  els.backToStates.style.display = show ? "inline-flex" : "none";
}

async function drillToState(stateFips, bounds) {
  state.selectedState = stateFips;
  state.mapMode = "counties"; // means counties overlay is active

  // Remove existing counties overlay (if any)
  if (state.countiesLayer) {
    map.removeLayer(state.countiesLayer);
    state.countiesLayer = null;
    state.countiesIndex = new Map();
  }

  clearCountyLabels(); // if you added county labels at high zoom

  // Load counties geojson and filter to the selected state
  const res = await fetch(APP_CONFIG.countiesGeojsonUrl);
  if (!res.ok) throw new Error("Failed to load counties GeoJSON");
  const geo = await res.json();

  state.countiesIndex = new Map();
  state.countiesLayer = L.geoJSON(geo, {
    filter: (feature) => getFipsFromFeature(feature).startsWith(stateFips),
    style: styleFor,
    onEachFeature: (feature, layer) => bindFeatureEvents(feature, layer)
  }).addTo(map);

  // Make sure counties are above states visually
  state.countiesLayer.bringToFront();

  // Keep states visible & clickable (don’t remove them)
  if (state.statesLayer) state.statesLayer.bringToBack();

  // Smooth zoom
  map.flyToBounds(bounds.pad(0.08), { duration: 0.9 });

  // Legend should now reflect counties
  updateLegend(state.min, state.max, "County HPI");

  // County labels may appear depending on zoom
  scheduleLabelUpdate();
}

function backToStates() {
  state.mapMode = "states";
  state.selectedState = null;
  state.selectedFips = null;

  clearCountyLabels();

  if (state.stateLabelLayer) {
    state.stateLabelLayer.addTo(map);
    }

  if (state.countiesLayer) map.removeLayer(state.countiesLayer);
  state.countiesLayer = null;
  state.countiesIndex = new Map();

  if (state.statesLayer) {
    state.statesLayer.addTo(map);
  }

  showBackButton(false);
  map.setView([39.5, -98.35], 4);
}

els.backToStates.addEventListener("click", backToStates);

function getStateName(feature) {
  const p = feature.properties || {};
  return p.name || p.NAME || p.State || p.state || "State";
}

function getFeatureCenter(layer) {
  return layer.getBounds().getCenter();
}

// map.on("zoomend", () => {
//   if (!state.stateLabelLayer) return;

//   if (map.getZoom() > 6) {
//     map.removeLayer(state.stateLabelLayer);
//   } else if (state.mapMode === "states") {
//     state.stateLabelLayer.addTo(map);
//   }
// });

//For labels
function getCountyName(feature) {
  const p = feature.properties || {};
  // Works with many county geojsons (including Plotly's counties geojson via NAME)
  return (p.NAME || p.name || p.NAMELSAD || "County").toString();
}

function clearCountyLabels() {
  if (state.countyLabelLayer) {
    state.countyLabelLayer.clearLayers();
    map.removeLayer(state.countyLabelLayer);
  }
  state.countyLabelLayer = null;
}

function buildCountyLabels() {
  clearCountyLabels();
  if (!state.countiesLayer) return;

  state.countyLabelLayer = L.layerGroup();

  state.countiesLayer.eachLayer(layer => {
    const feature = layer.feature;
    const name = getCountyName(feature);
    const center = layer.getBounds().getCenter();

    const marker = L.marker(center, {
      icon: L.divIcon({
        className: "county-label",
        html: name,
        iconSize: [140, 18]
      }),
      interactive: false
    });

    state.countyLabelLayer.addLayer(marker);
  });
}

function showCountyLabelsIfNeeded() {
  if (state.mapMode !== "counties") {
    clearCountyLabels();
    return;
  }

  const z = map.getZoom();
  if (z < COUNTY_LABEL_ZOOM) {
    if (state.countyLabelLayer) map.removeLayer(state.countyLabelLayer);
    return;
  }

  // Build once per counties load
  if (!state.countyLabelLayer) {
    buildCountyLabels();
  }

  if (state.countyLabelLayer && !map.hasLayer(state.countyLabelLayer)) {
    state.countyLabelLayer.addTo(map);
  }
}

// Throttle label updates (prevents rebuild spam on pan/zoom)
function scheduleLabelUpdate() {
  if (state._labelRaf) return;
  state._labelRaf = requestAnimationFrame(() => {
    state._labelRaf = null;
    showCountyLabelsIfNeeded();
  });
}

map.on("zoomend", scheduleLabelUpdate);
map.on("moveend", scheduleLabelUpdate);