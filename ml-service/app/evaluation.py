from decimal import Decimal, localcontext

from .preprocessing import build_daily_series
from .schemas import DailyDemand


def rolling_origin_backtest(
    history: list[DailyDemand],
    minimum_history_days: int = 14,
    horizon_days: int = 7,
    rolling_window_days: int = 7,
) -> dict[str, object]:
    series = build_daily_series(history)
    actuals: list[Decimal] = []
    predictions: list[Decimal] = []
    origins = 0

    for origin in range(minimum_history_days, len(series) - horizon_days + 1):
        origins += 1
        train = list(series.iloc[max(0, origin - rolling_window_days) : origin])
        test = list(series.iloc[origin : origin + horizon_days])
        if not train or not test:
            continue
        with localcontext() as context:
            context.prec = 34
            mean = sum(train, Decimal("0")) / Decimal(len(train))
        actuals.extend(test)
        predictions.extend([max(mean, Decimal("0"))] * len(test))

    if not actuals:
        return {
            "status": "insufficient_backtest_history",
            "origins": 0,
            "observations": 0,
            "mae": None,
            "wape": None,
            "note": "History is too short for the selected rolling-origin minimum and horizon.",
        }

    with localcontext() as context:
        context.prec = 34
        errors = [abs(actual - predicted) for actual, predicted in zip(actuals, predictions)]
        mae = sum(errors, Decimal("0")) / Decimal(len(errors))
        actual_total = sum(actuals, Decimal("0"))
        wape = (
            sum(errors, Decimal("0")) / actual_total
            if actual_total > 0
            else None
        )

    if not all(error.is_finite() for error in errors):
        raise ValueError("Backtest metrics exceed supported numeric range.")

    return {
        "status": "ok",
        "origins": origins,
        "observations": len(actuals),
        "mae": str(mae),
        "wape": None if wape is None else str(wape),
        "note": (
            "Rolling-origin time split; metrics describe only these historical windows and "
            "do not guarantee future accuracy."
        ),
    }