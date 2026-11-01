import os

from fastapi import FastAPI

from .evaluation import rolling_origin_backtest
from .prediction import forecast_demand
from .schemas import ForecastRequest, ForecastResponse

app = FastAPI(title="Stockly Demand Forecasting", version="0.1.0")


def configured_minimum_history_days() -> int:
    raw_value = os.getenv("MINIMUM_HISTORY_DAYS", "14")
    try:
        value = int(raw_value)
    except ValueError as error:
        raise RuntimeError("MINIMUM_HISTORY_DAYS must be an integer from 2 to 366.") from error
    if not 2 <= value <= 366:
        raise RuntimeError("MINIMUM_HISTORY_DAYS must be an integer from 2 to 366.")
    return value


MINIMUM_HISTORY_DAYS = configured_minimum_history_days()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "stockly-demand-forecast"}


@app.post("/forecast", response_model=ForecastResponse, response_model_by_alias=True)
def forecast(request: ForecastRequest) -> ForecastResponse:
    return forecast_demand(request, MINIMUM_HISTORY_DAYS)


@app.post("/evaluate")
def evaluate(request: ForecastRequest) -> dict[str, object]:
    metrics = rolling_origin_backtest(
        request.history.daily_demand,
        minimum_history_days=MINIMUM_HISTORY_DAYS,
        horizon_days=request.horizon_days,
        rolling_window_days=request.rolling_window_days,
    )
    return {
        "storeId": request.history.store_id,
        "productId": request.history.product_id,
        "unit": request.history.unit,
        "method": f"rolling_average_{request.rolling_window_days}d",
        **metrics,
    }
