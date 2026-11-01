from datetime import date, timedelta
from decimal import Decimal

import pandas as pd

from .schemas import DailyDemand


def build_daily_series(history: list[DailyDemand]) -> pd.Series:
    dates = [entry.date for entry in history]
    quantities = [entry.units_sold for entry in history]
    index = pd.DatetimeIndex(pd.to_datetime(dates), name="date")
    return pd.Series(quantities, index=index, dtype=object).asfreq("D", fill_value=Decimal("0"))


def next_dates(last_date: date, horizon_days: int) -> list[date]:
    return [last_date + timedelta(days=offset) for offset in range(1, horizon_days + 1)]