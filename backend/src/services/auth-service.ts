import argon2, { argon2id, type HashOptions } from "argon2";
import { randomBytes } from "node:crypto";
import { Types } from "mongoose";
import { UserModel, type User } from "../models/user";
import { ApiError } from "../utils/api-error";

const passwordHashOptions: HashOptions = {
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};
const dummyPasswordHash = argon2.hash(randomBytes(32).toString("hex"), passwordHashOptions);

export type PublicUser = {
  id: string;
  name: string;
  email: string;
};

export function toPublicUser(user: Pick<User, "name" | "email"> & { _id: Types.ObjectId }): PublicUser {
  return { id: user._id.toString(), name: user.name, email: user.email };
}

export async function registerUser(input: {
  name: string;
  email: string;
  password: string;
}): Promise<PublicUser> {
  const passwordHash = await argon2.hash(input.password, passwordHashOptions);
  try {
    const user = await UserModel.create({
      name: input.name,
      email: input.email,
      passwordHash,
      status: "active",
    });
    return toPublicUser(user);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    ) {
      throw new ApiError(409, "EMAIL_ALREADY_REGISTERED", "An account with this email already exists.");
    }
    throw error;
  }
}

export async function verifyLogin(email: string, password: string): Promise<PublicUser> {
  const user = await UserModel.findOne({ email }).select("+passwordHash");
  if (!user || user.status !== "active") {
    await argon2.verify(await dummyPasswordHash, password).catch(() => false);
    throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
  }

  const passwordMatches = await argon2.verify(user.passwordHash, password).catch(() => false);
  if (!passwordMatches) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
  }
  return toPublicUser(user);
}
