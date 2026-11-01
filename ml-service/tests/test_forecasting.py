from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.evaluation import rolling_origin_backtest
from app.main import app
from app.prediction import forecast_demand
from app.preprocessing import build_daily_series
from app.schemas import DailyDemand, ForecastRequest, ProductDemandHistory

client = TestClient(app)
STORE_ID = "64b000000000000000000001"
PRODUCT_ID = "64b000000000000000000002"


def history(values: list[str], start: date = date(2026, 1, 1)) -> ProductDemandHistory:
    return ProductDemandHistory.model_validate(
        {
            "storeId": STORE_ID,
            "productId": PRODUCT_ID,
            "unit": "kg",
            "availability": None,
            "availabilityNote": "Historical availability unknown.",
            "dailyDemand": [
                {"date": (start + timedelta(days=index)).isoformat(), "unitsSold": value}
                for index, value in enumerate(values)
            ],
        }
    )


def forecast_payload(values: list[str], **options: object) -> dict[str, object]:
    return {
        "history": history(values).model_dump(by_alias=True, mode="json"),
        **options,
    }


def test_health_endpoint() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "stockly-demand-forecast"}


def test_rolling_average_preserves_fractional_units_and_previous_week_values() -> None:
    values = ["0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7"] * 2
    response = client.post("/forecast", json=forecast_payload(values))

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["method"] == "rolling_average_7d"
    assert body["horizonDays"] == 7
    assert body["forecasts"][0]["predictedUnits"] == "0.4"
    assert body["forecasts"][0]["previousWeekUnits"] == "0.1"
    assert body["forecasts"][0]["date"] == "2026-01-15"
    assert any("not a trained" in note for note in body["limitations"])


def test_rolling_average_preserves_fractional_quantity_with_bounded_precision() -> None:
    quantity = "0.1234567890123456789012345678901234"
    response = client.post("/forecast", json=forecast_payload([quantity] * 14))

    assert response.status_code == 200
    assert response.json()["forecasts"][0]["predictedUnits"] == "0.12345678901234567890123456789012"


def test_non_terminating_daily_average_stays_within_decimal128_precision() -> None:
    response = client.post("/forecast", json=forecast_payload(["0"] * 6 + ["0.4"] + ["0"] * 23))

    assert response.status_code == 200
    predicted = response.json()["forecasts"][0]["predictedUnits"]
    significant_digits = len(predicted.replace(".", "").lstrip("0"))
    assert significant_digits <= 34


def test_insufficient_history_returns_status_without_estimates() -> None:
    body = client.post("/forecast", json=forecast_payload(["1"] * 13)).json()
    assert body["status"] == "insufficient_history"
    assert body["forecasts"] == []
    assert body["observedHistoryDays"] == 13


def test_all_zero_history_reports_zero_demand_without_accuracy_claim() -> None:
    body = client.post("/forecast", json=forecast_payload(["0"] * 14)).json()
    assert body["status"] == "zero_demand"
    assert all(point["predictedUnits"] == "0" for point in body["forecasts"])
    assert "does not establish" in body["comparison"]


def test_missing_dates_are_explicit_zero_demand_days() -> None:
    payload = {
        "storeId": STORE_ID,
        "productId": PRODUCT_ID,
        "unit": "kg",
        "dailyDemand": [
            {"date": "2026-01-01", "unitsSold": "0.25"},
            {"date": "2026-01-03", "unitsSold": "0.75"},
        ],
    }
    parsed = ProductDemandHistory.model_validate(payload)
    series = build_daily_series(parsed.daily_demand)
    assert list(series) == [Decimal("0.25"), Decimal("0"), Decimal("0.75")]


def test_invalid_decimal_and_unsorted_duplicate_dates_are_rejected() -> None:
    invalid_value = forecast_payload(["1"] * 14)
    invalid_value["history"]["dailyDemand"][0]["unitsSold"] = "-1"  # type: ignore[index]
    assert client.post("/forecast", json=invalid_value).status_code == 422

    invalid_dates = forecast_payload(["1"] * 14)
    invalid_dates["history"]["dailyDemand"][1]["date"] = "2026-01-01"  # type: ignore[index]
    assert client.post("/forecast", json=invalid_dates).status_code == 422

    invalid_fraction = forecast_payload(["1"] * 14)
    invalid_fraction["history"]["dailyDemand"][0]["unitsSold"] = "NaN"  # type: ignore[index]
    assert client.post("/forecast", json=invalid_fraction).status_code == 422

    numeric_quantity = forecast_payload(["1"] * 14)
    numeric_quantity["history"]["dailyDemand"][0]["unitsSold"] = 0.1  # type: ignore[index]
    assert client.post("/forecast", json=numeric_quantity).status_code == 422


def test_history_span_is_limited_to_366_calendar_days() -> None:
    payload = {
        "storeId": STORE_ID,
        "productId": PRODUCT_ID,
        "unit": "kg",
        "dailyDemand": [
            {"date": "2024-01-01", "unitsSold": "1"},
            {"date": "2026-01-01", "unitsSold": "1"},
        ],
    }
    assert client.post("/forecast", json={"history": payload}).status_code == 422


def test_horizon_and_unknown_fields_are_rejected() -> None:
    assert client.post("/forecast", json=forecast_payload(["1"] * 14, horizonDays=31)).status_code == 422
    assert client.post("/forecast", json=forecast_payload(["1"] * 14, source="fake")).status_code == 422
    assert client.post(
        "/forecast",
        json=forecast_payload(["1"] * 14, minimumHistoryDays=2),
    ).status_code == 422


def test_configured_minimum_history_is_applied_by_service_configuration() -> None:
    request = ForecastRequest.model_validate(
        {
            "history": history(["1"] * 5).model_dump(by_alias=True, mode="json"),
        }
    )
    result = forecast_demand(request, configured_minimum_history_days=5)
    assert result.status == "ok"
    assert result.minimum_history_days == 5


def test_backtest_reports_mae_and_wape_for_a_rolling_origin() -> None:
    demand = [
        DailyDemand(
            date=date(2026, 1, 1) + timedelta(days=index),
            unitsSold="1" if index < 14 else "10",
        )
        for index in range(21)
    ]
    metrics = rolling_origin_backtest(demand, minimum_history_days=14, horizon_days=7)
    assert metrics["status"] == "ok"
    assert metrics["origins"] == 1
    assert metrics["mae"] == "9"
    assert metrics["wape"] == "0.9"


def test_backtest_uses_rolling_origin_and_wape_handles_zero_actuals() -> None:
    demand = [DailyDemand(date=date(2026, 1, 1) + timedelta(days=index), unitsSold="0") for index in range(28)]
    metrics = rolling_origin_backtest(demand, minimum_history_days=14, horizon_days=7)
    assert metrics["status"] == "ok"
    assert metrics["origins"] == 8
    assert metrics["mae"] == "0"
    assert metrics["wape"] is None


def test_backtest_reports_insufficient_time_series_history() -> None:
    demand = [DailyDemand(date=date(2026, 1, 1) + timedelta(days=index), unitsSold="1") for index in range(10)]
    metrics = rolling_origin_backtest(demand)
    assert metrics["status"] == "insufficient_backtest_history"
    assert metrics["mae"] is None
    assert metrics["wape"] is None
