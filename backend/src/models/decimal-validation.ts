import type { Types } from "mongoose";

type DecimalParts = {
  coefficient: bigint;
  scale: number;
};

function parseDecimal(value: Types.Decimal128): DecimalParts | null {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(value.toString());

  if (!match || (!match[2] && !match[3])) {
    return null;
  }

  const sign = match[1] === "-" ? -1n : 1n;
  const fraction = match[3] ?? "";
  const exponent = Number(match[4] ?? "0");
  let digits = `${match[2] || "0"}${fraction}`;
  let scale = fraction.length - exponent;

  if (!Number.isSafeInteger(scale)) {
    return null;
  }

  if (scale < 0) {
    digits += "0".repeat(-scale);
    scale = 0;
  }

  return {
    coefficient: sign * BigInt(digits),
    scale,
  };
}

export function isNonNegativeDecimal(value: Types.Decimal128): boolean {
  const parsed = parseDecimal(value);
  return parsed !== null && parsed.coefficient >= 0n;
}

export function isNonZeroDecimal(value: Types.Decimal128): boolean {
  const parsed = parseDecimal(value);
  return parsed !== null && parsed.coefficient !== 0n;
}

export function isPositiveDecimal(value: Types.Decimal128): boolean {
  const parsed = parseDecimal(value);
  return parsed !== null && parsed.coefficient > 0n;
}

export function isLessThanOrEqual(
  left: Types.Decimal128,
  right: Types.Decimal128,
): boolean {
  const leftParts = parseDecimal(left);
  const rightParts = parseDecimal(right);

  if (!leftParts || !rightParts) {
    return false;
  }

  const scale = Math.max(leftParts.scale, rightParts.scale);
  const leftValue = leftParts.coefficient * 10n ** BigInt(scale - leftParts.scale);
  const rightValue = rightParts.coefficient * 10n ** BigInt(scale - rightParts.scale);

  return leftValue <= rightValue;
}
