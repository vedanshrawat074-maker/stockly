import { model, Schema, type Types } from "mongoose";

export type UserStatus = "active" | "disabled";

export interface User {
  name: string;
  email: string;
  passwordHash: string;
  status: UserStatus;
}

const userSchema = new Schema<User>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    passwordHash: { type: String, required: true, select: false },
    status: { type: String, enum: ["active", "disabled"], default: "active", required: true },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true });

export const UserModel = model<User>("User", userSchema);
export type UserId = Types.ObjectId;
