import { ApiError } from "../utils/api-error";

export type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

export function getStoreLocalDate(date: Date, timeZone: string): CalendarDate {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
  } catch {
    throw new ApiError(400, "INVALID_STORE_TIMEZONE", "Store timezone is not a valid IANA timezone.");
  }

  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
  };
}

export function getExpiryDateOnly(date: Date): CalendarDate {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

export function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

export function compareCalendarDates(left: CalendarDate, right: CalendarDate): number {
  const leftKey = left.year * 10_000 + left.month * 100 + left.day;
  const rightKey = right.year * 10_000 + right.month * 100 + right.day;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

export function calendarDateString(date: CalendarDate): string {
  return `${date.year.toString().padStart(4, "0")}-${date.month.toString().padStart(2, "0")}-${date.day.toString().padStart(2, "0")}`;
}
