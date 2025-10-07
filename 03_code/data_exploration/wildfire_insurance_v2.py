import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

# Read the relevant columns in wildfire insurance data in 2023
wildfire_insurance_cols = ['Calendar Year', 'ZIP Code', 'County', 'Earned Prem', 'Cat CovA Fire Losses', 'Cat CovA Fire Count']
wildfire_insurance = pd.read_excel("02_processed_data/Residential-Property-Coverage-Amounts-Wildfire-Risk-and-Losses_Export.xlsx", sheet_name="Export_23", skiprows=2, usecols=wildfire_insurance_cols)
wildfire_insurance["ZIP Code"] = wildfire_insurance["ZIP Code"].astype(str)

# Read the columns related to wildfire risk in NRI data
nri_cols = ['COUNTY', 'WFIR_RISKV', 'WFIR_EALT', 'WFIR_HLRR', 'WFIR_EXPB']
nri = pd.read_csv("01_original_data/NRI_Table_Counties.csv", usecols=nri_cols)
# Rename "county" variable name
nri_cols_new = {'COUNTY': 'County'}
nri = nri.rename(columns=nri_cols_new)
# Merge the NRI data with the wildfire insurance data
wildfire_insurance = pd.merge(wildfire_insurance, nri, on="County", how="left")

# Convert historical loss ratio ratings to numbers
risk_level_map = {
    "Very Low": 1,
    "Relatively Low": 2,
    "Relatively Moderate": 3,
    "Relatively High": 4,
    "Very High": 5
}
wildfire_insurance["WFIR_HLRR_SCORE"] = wildfire_insurance["WFIR_HLRR"].map(risk_level_map)

# Read the relevant columns in geospatial coordinates data
coordinates_cols = ['county', 'lat', 'lng', 'population']
coordinates = pd.read_csv("01_original_data/uscounties.csv", usecols=coordinates_cols)
# Rename "county" variable name
coordinates_cols_new = {'county': 'County'}
coordinates = coordinates.rename(columns=coordinates_cols_new)
# Merge the NRI data with the wildfire insurance data
wildfire_insurance = pd.merge(wildfire_insurance, coordinates, on="County", how="left")

agg_wildfire = wildfire_insurance.groupby(["Calendar Year", "County"], as_index=False).agg({
    "Earned Prem": "sum",
    "Cat CovA Fire Losses": "sum",
    "Cat CovA Fire Count": "sum",
    "WFIR_EXPB": "mean",
    "WFIR_HLRR_SCORE": "mean",
    "WFIR_EALT": "sum",
    "WFIR_RISKV": "sum",
    "lat": "mean",
    "lng": "mean",
    "population": "sum"
})

# New variable fire loss rate per claim
agg_wildfire["Fire_Loss_Rate"] = agg_wildfire.apply(
    lambda row: row["Cat CovA Fire Losses"] / row["Cat CovA Fire Count"]
    if row["Cat CovA Fire Count"] > 0 else 0,
    axis=1
)

# New variable Loss Ratio: Total Loss / Earned Premium
agg_wildfire["Loss_Ratio"] = agg_wildfire.apply(
    lambda row: row["Cat CovA Fire Losses"] / row["Earned Prem"]
    if row["Earned Prem"] > 0 else 0,
    axis=1
)


# Longitude need fix, partial EDA
plt.figure(figsize=(10, 8))
plt.scatter(
    agg_wildfire["lng"], agg_wildfire["lat"],
    s=10, color="gray", alpha=0.4, label="County"
)

weights = agg_wildfire["Cat CovA Fire Losses"]
sns.kdeplot(
    x=agg_wildfire["lng"],
    y=agg_wildfire["lat"],
    weights=weights,
    cmap="Reds", fill=True, alpha=0.7, bw_adjust=0.3
)

plt.title("Wildfire-Related Activity in California (2023)")
plt.xlabel("Longitude")
plt.ylabel("Latitude")
plt.xlim(-125, -114)
plt.ylim(32, 43)
plt.legend()
plt.grid(True)
plt.tight_layout()
plt.show()


