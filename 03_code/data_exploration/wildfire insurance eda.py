import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

# Import file
wildfire_insurance = pd.read_excel("02_processed_data/Residential-Property-Coverage-Amounts-Wildfire-Risk-and-Losses_Export.xlsx", sheet_name="Export_all", skiprows=2
wildfire_insurance["ZIP Code"] = wildfire_insurance["ZIP Code"].astype(str)
# Keep the variables of interest
wildfire_small = wildfire_insurance[['Calendar Year', 'ZIP Code', 'Earned Prem', 'Cat CovA Fire Losses', 'Cat CovA Fire Count']]

# Earned Premium by year
wildfire_small.groupby("Calendar Year")["Earned Prem"].sum().plot(kind="bar")
plt.title("Earned Premium by Year")
plt.xlabel("Calendar Year")
plt.ylabel("Total Earned Premium")
plt.tight_layout(rect=[0, 0, 1, 0.95])
plt.show()

# Aggregate at zipcode level
agg_wildfire = wildfire_small.groupby(["Calendar Year", "ZIP Code"], as_index=False).agg({
    "Earned Prem": "sum",
    "Cat CovA Fire Losses": "sum",
    "Cat CovA Fire Count": "sum"
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

# Top 10 earned premium by zipcode
top_Earned_Prem_23 = agg_wildfire[agg_wildfire["Calendar Year"] == 23] \
    .sort_values("Earned Prem", ascending=False) \
    .head(10)
plt.figure(figsize=(8, 5))
plt.barh(top_Earned_Prem_23["ZIP Code"], top_Earned_Prem_23["Earned Prem"])
plt.xlabel("Earned Premium")
plt.ylabel("ZIP Code")
plt.title("Top 10 ZIPs by Earned Premium in 2023")
plt.gca().invert_yaxis()
plt.tight_layout()
plt.show()

# Top 10 highest fire loss rate by zipcode
top_flr_23 = agg_wildfire[agg_wildfire["Calendar Year"] == 23] \
    .sort_values("Fire_Loss_Rate", ascending=False) \
    .head(10)
plt.figure(figsize=(8, 5))
plt.barh(top_flr_23["ZIP Code"], top_flr_23["Fire_Loss_Rate"])
plt.xlabel("Fire Loss Rate (Loss / Count)")
plt.ylabel("ZIP Code")
plt.title("Top 10 ZIPs by Fire Loss Rate in 2023")
plt.gca().invert_yaxis()
plt.tight_layout()
plt.show()

# Top 10 highest loss ratio by zipcode
top_lr_23 = agg_wildfire[agg_wildfire["Calendar Year"] == 23] \
    .sort_values("Loss_Ratio", ascending=False) \
    .head(10)
plt.figure(figsize=(8, 5))
plt.barh(top_lr_23["ZIP Code"], top_lr_23["Loss_Ratio"])
plt.xlabel("Loss Ratio (Loss / Earned Premium)")
plt.ylabel("ZIP Code")
plt.title("Top 10 ZIPs by Loss Ratio in 2023")
plt.gca().invert_yaxis()
plt.tight_layout()
plt.show()

