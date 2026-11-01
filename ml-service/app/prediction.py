from datetime import timedelta
from decimal import Decimal, localcontext

from .preprocessing import build_daily_series, next_dates
from .schemas import ForecastPoint, ForecastRequest, ForecastResponse


def forecast_demand(
    request: ForecastRequest,
    configured_minimum_history_days: int,
) -> ForecastResponse:
    history = request.history
    series = build_daily_series(history.daily_demand)
    minimum_history = configured_minimum_history_days
    observed_days = len(series)
    last_observed_date = history.daily_demand[-1].date
    recent = list(series.iloc[-request.rolling_window_days :])
    with localcontext() as context:
        context.prec = 32
        recent_average = (
            sum(recent, Decimal("0")) / Decimal(len(recent)) if recent else Decimal("0")
        )
    all_zero = all(value == 0 for value in series)
    insufficient = observed_days < minimum_history

    if insufficient:
        status = "insufficient_history"
        predictions = []
        comparison = (
            "Forecast withheld because the configured minimum history is not available."
        )
    elif all_zero:
        status = "zero_demand"
        predictions = [Decimal("0")] * request.horizon_days
        comparison = (
            "All recorded sales in the observed series were zero; this does not establish "
            "that the store was open or the product was available."
        )
    else:
        status = "ok"
        predictions = [max(recent_average, Decimal("0"))] * request.horizon_days
        comparison = (
            "Previous-week values are same-weekday observations where available; they are "
            "comparators, not evidence that the baseline is more accurate."
        )

    previous_week = {point_date.date(): value for point_date, value in series.items()}
    forecasts = []
    for forecast_date, predicted in zip(
        next_dates(last_observed_date, request.horizon_days), predictions
    ):
        forecasts.append(
            ForecastPoint(
                date=forecast_date,
                predicted_units=format(predicted, "f"),
                previous_week_units=(
                    format(previous_week[forecast_date - timedelta(days=7)], "f")
                    if forecast_date - timedelta(days=7) in previous_week
                    else None
                ),
            )
        )

    limitations = [
        "Missing recorded sales dates are treated as zero sales.",
        history.availability_note
        or "Historical store opening, stockout, and product availability intervals are unknown.",
        "This is a rolling-average baseline, not a trained machine-learning model.",
        "Forecast accuracy has not been established without representative rolling-origin backtesting.",
    ]

    return ForecastResponse(
        store_id=history.store_id,
        product_id=history.product_id,
        unit=history.unit,
        status=status,
        method=f"rolling_average_{request.rolling_window_days}d",
        horizon_days=request.horizon_days,
        minimum_history_days=minimum_history,
        observed_history_days=observed_days,
        history_through=last_observed_date,
        forecasts=forecasts,
        comparison=comparison,
        limitations=limitations,
    )