"""Space radiation exposure by environment, and cumulative-dose tracking.

Reference daily effective dose rates (approximate, quiet Sun, behind typical shielding):
  station           ~0.5 mSv/day   ISS crews receive roughly 80-160 mSv per 6 months
  spacecraft        ~1.8 mSv/day   deep-space cruise, MSL/RAD (Zeitlin et al. 2013, Science) 1.84 mSv/day
  lunar_surface     ~1.4 mSv/day   Chang'e-4 LND (Zhang et al. 2020, Sci. Adv.) about 1.37 mSv/day
  mars_surface      ~0.7 mSv/day   Curiosity RAD (Hassler et al. 2014, Science) about 0.64 mSv/day
  rover             surface value for the body it drives on, with less shielding (x1.2 design factor)
Career limit: 600 mSv effective dose (NASA-STD-3001 Vol. 1 Rev. B). Values are for demo modelling and
should be checked against current sources before any formal claim.
"""
from __future__ import annotations

from dataclasses import dataclass

CAREER_LIMIT_MSV = 600.0
SPE_LIMIT_MSV = 250.0

BASE_RATE_MSV_DAY = {
    "station": 0.5,
    "spacecraft": 1.8,
    "lunar_base": 1.4,
    "mars_base": 0.7,
}
# Map the app's environment values onto a dose model
ENVIRONMENT_MODEL = {
    "station": "station",
    "spacecraft": "spacecraft",
    "planetary_base": "lunar_base",
    "rover": "lunar_base",
}
SHIELDING_FACTOR = {"station": 1.0, "spacecraft": 1.0, "planetary_base": 1.0, "rover": 1.2, "eva": 1.5,
                    "storm_shelter": 0.3}


def daily_dose(environment: str, *, location: str | None = None, proton_pfu: float | None = None,
               body: str | None = None) -> float:
    """Estimated effective dose in mSv for one day.

    proton_pfu: GOES >=10 MeV integral proton flux. Above the S1 threshold (10 pfu) a solar particle
    event adds dose roughly in proportion to flux; this is a coarse demo model, not a transport code.
    """
    model = ENVIRONMENT_MODEL.get(environment, "station")
    if body == "mars" and environment in ("planetary_base", "rover"):
        model = "mars_base"
    rate = BASE_RATE_MSV_DAY[model]
    factor = SHIELDING_FACTOR.get(location or environment, 1.0)
    spe = 0.0
    if proton_pfu is not None and proton_pfu >= 10:
        # Earth's magnetosphere shields the station strongly; deep space and the Moon get the full event.
        exposure = 0.05 if model == "station" else (0.3 if model == "mars_base" else 1.0)
        spe = exposure * 0.05 * proton_pfu ** 0.8  # ~3 mSv/day at 100 pfu unshielded (demo scaling)
    return round((rate + spe) * factor, 3)


def dose_rate_usv_h(daily_msv: float) -> float:
    return round(daily_msv * 1000 / 24, 2)


@dataclass
class DoseStatus:
    cumulative_msv: float
    fraction_of_limit: float
    days_of_margin: float | None
    level: str  # green / yellow / red

    def as_dict(self) -> dict:
        return self.__dict__.copy()


def dose_status(cumulative_msv: float, current_daily_msv: float) -> DoseStatus:
    frac = cumulative_msv / CAREER_LIMIT_MSV
    margin = (CAREER_LIMIT_MSV - cumulative_msv) / current_daily_msv if current_daily_msv > 0 else None
    level = "green" if frac < 0.5 else "yellow" if frac < 0.75 else "red"
    return DoseStatus(round(cumulative_msv, 2), round(frac, 3), None if margin is None else round(margin, 1), level)
