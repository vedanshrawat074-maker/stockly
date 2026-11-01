from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)
from typing_extensions import Annotated

ObjectIdString = Annotated[str, StringConstraints(pattern=r"^[a-fA-F0-9]{24}$")]


def require_decimal_string(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("Demand quantities must be decimal strings.")
    return value


NonNegativeDecimal = Annotated[
    Decimal,
    BeforeValidator(require_decimal_string),
    Field(ge=Decimal("0"), max_digits=34),
]


class DailyDemand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: date
    units_sold: NonNegativeDecimal = Field(alias="unitsSold")


class AvailabilityInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    known: bool
    available: bool | None
    note: str


class ProductDemandHistory(BaseModel):
    model_config = ConfigDict(extra="forbid")

    store_id: ObjectIdString = Field(alias="storeId")
    product_id: ObjectIdString = Field(alias="productId")
    unit: str = Field(min_length=1, max_length=40)
    availability: AvailabilityInfo | None = None
    availability_note: str | None = Field(default=None, alias="availabilityNote")
    daily_demand: list[DailyDemand] = Field(alias="dailyDemand", min_length=1, max_length=366)

    @field_validator("daily_demand")
    @classmethod
    def dates_must_be_unique_and_sorted(cls, values: list[DailyDemand]) -> list[DailyDemand]:
        dates = [entry.date for entry in values]
        if dates != sorted(set(dates)):
            raise ValueError("dailyDemand dates must be unique and sorted.")
        return values

    @model_validator(mode="after")
    def date_range_must_be_bounded(self) -> "ProductDemandHistory":
        dates = [entry.date for entry in self.daily_demand]
        if (dates[-1] - dates[0]).days >= 366:
            raise ValueError("dailyDemand date range must not exceed 366 days.")
        return self


class ForecastRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    history: ProductDemandHistory
    horizon_days: int = Field(default=7, alias="horizonDays", ge=1, le=30)
    rolling_window_days: int = Field(default=7, alias="rollingWindowDays", ge=1, le=90)


class ForecastPoint(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    date: date
    predicted_units: str = Field(alias="predictedUnits")
    previous_week_units: str | None = Field(default=None, alias="previousWeekUnits")


class ForecastResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    store_id: ObjectIdString = Field(alias="storeId")
    product_id: ObjectIdString = Field(alias="productId")
    unit: str
    status: Literal["ok", "insufficient_history", "zero_demand"]
    method: str
    horizon_days: int = Field(alias="horizonDays")
    minimum_history_days: int = Field(alias="minimumHistoryDays")
    observed_history_days: int = Field(alias="observedHistoryDays")
    history_through: date = Field(alias="historyThrough")
    forecasts: list[ForecastPoint]
    comparison: str
    limitations: list[str]