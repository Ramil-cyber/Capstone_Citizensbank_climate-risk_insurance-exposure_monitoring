from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Dict, Any, Optional

import pandas as pd
import requests
from flask import Flask, jsonify, render_template, request, send_from_directory

APP_ROOT = os.path.dirname(os.path.abspath(__file__))

DATA_CSV = os.path.join(APP_ROOT, "data", "hpi_county_2026_2030.csv")
COUNTIES_GEOJSON = os.path.join(APP_ROOT, "static", "data", "counties.geojson")

YEARS = [2026, 2027, 2028, 2029, 2030]

app = Flask(__name__)


@dataclass(frozen=True)
class HPIIndex:
    # year -> dict(fips -> hpi_value)
    by_year: Dict[int, Dict[str, float]]
    # year -> (min, max) for scaling
    year_range: Dict[int, Dict[str, float]]


HPI_CACHE: Optional[HPIIndex] = None

ZIP_TO_COUNTY_CSV = os.path.join(APP_ROOT, "data", "zip_to_county.csv")
ZIP_CACHE = None


def get_zip_cache():
    global ZIP_CACHE
    if ZIP_CACHE is None:
        df = pd.read_csv(ZIP_TO_COUNTY_CSV, dtype={"zip": str, "county_fips": str})
        df["zip"] = df["zip"].str.zfill(5)
        df["county_fips"] = df["county_fips"].str.zfill(5)
        ZIP_CACHE = dict(zip(df["zip"], df["county_fips"]))
    return ZIP_CACHE


def _load_hpi() -> HPIIndex:
    df = pd.read_csv(DATA_CSV, dtype={"fips": str})
    df["fips"] = df["fips"].str.zfill(5)

    by_year: Dict[int, Dict[str, float]] = {}
    year_range: Dict[int, Dict[str, float]] = {}

    for y in YEARS:
        col = f"hpi_{y}"
        if col not in df.columns:
            raise ValueError(f"Missing required column: {col}")

        series = pd.to_numeric(df[col], errors="coerce")
        mapping = dict(zip(df["fips"], series.fillna(float("nan"))))

        # Compute min/max ignoring NaNs
        valid = series.dropna()
        if len(valid) == 0:
            mn, mx = 0.0, 1.0
        else:
            mn, mx = float(valid.min()), float(valid.max())

        by_year[y] = mapping
        year_range[y] = {"min": mn, "max": mx}

    return HPIIndex(by_year=by_year, year_range=year_range)


def get_cache() -> HPIIndex:
    global HPI_CACHE
    if HPI_CACHE is None:
        HPI_CACHE = _load_hpi()
    return HPI_CACHE


@app.get("/")
def index():
    cache = get_cache()
    return render_template(
        "index.html",
        years=YEARS,
        year_min=min(YEARS),
        year_max=max(YEARS),
        year_ranges=cache.year_range,
    )


@app.get("/api/hpi")
def api_hpi():
    """
    Returns:
      {
        "year": 2026,
        "min": ...,
        "max": ...,
        "values": { "01001": 241.3, ... }
      }
    """
    year = int(request.args.get("year", YEARS[0]))
    if year not in YEARS:
        return jsonify({"error": "Invalid year"}), 400

    cache = get_cache()
    return jsonify(
        {
            "year": year,
            "min": cache.year_range[year]["min"],
            "max": cache.year_range[year]["max"],
            "values": cache.by_year[year],
        }
    )


@app.get("/api/county_series/<fips>")
def county_series(fips: str):
    fips = str(fips).zfill(5)

    df = pd.read_csv(DATA_CSV, dtype={"fips": str})
    df["fips"] = df["fips"].str.zfill(5)

    row = df.loc[df["fips"] == fips]
    if row.empty:
        return jsonify({"error": "County not found in HPI dataset"}), 404

    r = row.iloc[0].to_dict()

    series = {}
    for y in YEARS:
        series[str(y)] = (
            float(r.get(f"hpi_{y}")) if pd.notna(r.get(f"hpi_{y}")) else None
        )

    return jsonify(
        {
            "fips": fips,
            "county": r.get("county"),
            "state": r.get("state"),
            "series": series,
        }
    )


@app.get("/static/data/counties.geojson")
def serve_counties_geojson():
    # Explicit route so deployment proxies don't mis-handle large static
    return send_from_directory(
        os.path.join(APP_ROOT, "static", "data"), "counties.geojson"
    )


@app.post("/api/zip_to_county")
def zip_to_county():
    payload = request.get_json(force=True, silent=True) or {}
    zip_code = str(payload.get("zip", "")).strip()

    if not (zip_code.isdigit() and len(zip_code) in (5, 9)):
        return (
            jsonify({"error": "ZIP must be 5 digits (or 9 digits without hyphen)."}),
            400,
        )

    zip5 = zip_code[:5]
    zmap = get_zip_cache()
    county_fips = zmap.get(zip5)

    if not county_fips:
        return jsonify({"error": "ZIP not found in offline mapping."}), 404

    return jsonify({"zip": zip5, "county_fips": county_fips})


if __name__ == "__main__":
    # For local dev
    app.run(debug=True, host="0.0.0.0", port=5050)
