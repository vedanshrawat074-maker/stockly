import type { Types } from "mongoose";

declare global {
  namespace Express {
    interface Locals {
      storeId: Types.ObjectId;
    }
  }
}

export {};
