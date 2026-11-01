import { Types } from "mongoose";

type DecimalValue = {
  coefficient: bigint;
  scale: number;
};

function parseDecimal(value: string | Types.Decimal128): DecimalValue {
  const text = value.toString();
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match || (!match[2] && !match[3])) {
    throw new Error("Invalid decimal value.");
  }

  const fraction = match[3] ?? "";
  const exponent = Number(match[4] ?? "0");
  let digits = `${match[2] || "0"}${fraction}`;
  let scale = fraction.length - exponent;
  if (!Number.isSafeInteger(scale)) throw new Error("Invalid decimal scale.");

  if (scale < 0) {
    digits += "0".repeat(-scale);
    scale = 0;
  }

  return {
    coefficient: (match[1] === "-" ? -1n : 1n) * BigInt(digits),
    scale,
  };
}

function decimalToString(value: DecimalValue): string {
  const negative = value.coefficient < 0n;
  let digits = (negative ? -value.coefficient : value.coefficient).toString();
  if (value.scale === 0) return `${negative ? "-" : ""}${digits}`;

  digits = digits.padStart(value.scale + 1, "0");
  const decimalIndex = digits.length - value.scale;
  const whole = digits.slice(0, decimalIndex);
  const fractional = digits.slice(decimalIndex).replace(/0+$/, "");
  const result = fractional.length > 0 ? `${whole}.${fractional}` : whole;
  return `${negative ? "-" : ""}${result}`;
}

function toDecimal128(value: DecimalValue): Types.Decimal128 {
  const formatted = decimalToString(value);
  const significantDigits = formatted.replace(/[-.]/g, "").replace(/^0+/, "").length;
  if (significantDigits > 34) {
    throw new Error("Decimal arithmetic exceeds Decimal128 precision.");
  }
  return Types.Decimal128.fromString(formatted);
}

function align(left: DecimalValue, right: DecimalValue): [bigint, bigint, number] {
  const scale = Math.max(left.scale, right.scale);
  return [
    left.coefficient * 10n ** BigInt(scale - left.scale),
    right.coefficient * 10n ** BigInt(scale - right.scale),
    scale,
  ];
}

export function addDecimals(
  left: string | Types.Decimal128,
  right: string | Types.Decimal128,
): Types.Decimal128 {
  const [leftValue, rightValue, scale] = align(parseDecimal(left), parseDecimal(right));
  return toDecimal128({ coefficient: leftValue + rightValue, scale });
}

export function subtractDecimals(
  left: string | Types.Decimal128,
  right: string | Types.Decimal128,
): Types.Decimal128 {
  const [leftValue, rightValue, scale] = align(parseDecimal(left), parseDecimal(right));
  return toDecimal128({ coefficient: leftValue - rightValue, scale });
}

export function multiplyDecimals(
  left: string | Types.Decimal128,
  right: string | Types.Decimal128,
): Types.Decimal128 {
  const leftValue = parseDecimal(left);
  const rightValue = parseDecimal(right);
  return toDecimal128({
    coefficient: leftValue.coefficient * rightValue.coefficient,
    scale: leftValue.scale + rightValue.scale,
  });
}

export function compareDecimals(
  left: string | Types.Decimal128,
  right: string | Types.Decimal128,
): number {
  const [leftValue, rightValue] = align(parseDecimal(left), parseDecimal(right));
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

export function negateDecimal(value: string | Types.Decimal128): Types.Decimal128 {
  const parsed = parseDecimal(value);
  return toDecimal128({ coefficient: -parsed.coefficient, scale: parsed.scale });
}
