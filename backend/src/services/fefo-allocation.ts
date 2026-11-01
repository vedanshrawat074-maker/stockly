import { Types } from "mongoose";
import { compareDecimals, subtractDecimals } from "../utils/decimal-arithmetic";

export type FefoCandidate = {
  _id: Types.ObjectId;
  remainingQuantity: Types.Decimal128;
  expiryDate?: Date;
  receivedDate: Date;
};

export type FefoAllocation = {
  batch: FefoCandidate;
  quantity: Types.Decimal128;
};

export type FefoPlan = {
  allocations: FefoAllocation[];
  outstanding: Types.Decimal128;
};

function sortFefo(left: FefoCandidate, right: FefoCandidate): number {
  if (left.expiryDate && right.expiryDate) {
    const expiryOrder = left.expiryDate.getTime() - right.expiryDate.getTime();
    if (expiryOrder !== 0) return expiryOrder;
  } else if (left.expiryDate) {
    return -1;
  } else if (right.expiryDate) {
    return 1;
  }

  const receivedOrder = left.receivedDate.getTime() - right.receivedDate.getTime();
  return receivedOrder || left._id.toHexString().localeCompare(right._id.toHexString());
}

export function planFefoAllocations(
  candidates: FefoCandidate[],
  requested: Types.Decimal128,
  now: Date,
): FefoPlan {
  let outstanding = requested;
  const allocations: FefoAllocation[] = [];
  const eligible = candidates
    .filter(
      (candidate) =>
        compareDecimals(candidate.remainingQuantity, "0") > 0 &&
        (candidate.expiryDate === undefined || candidate.expiryDate > now),
    )
    .sort(sortFefo);

  for (const batch of eligible) {
    if (compareDecimals(outstanding, "0") <= 0) break;
    const quantity =
      compareDecimals(batch.remainingQuantity, outstanding) <= 0
        ? batch.remainingQuantity
        : outstanding;
    allocations.push({ batch, quantity });
    outstanding = subtractDecimals(outstanding, quantity);
  }

  return { allocations, outstanding };
}
