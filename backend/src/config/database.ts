import mongoose from "mongoose";

export type DatabaseStatus = "connected" | "connecting" | "disconnected" | "disconnecting";

const connectionStates: Record<number, DatabaseStatus> = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
};

export function getDatabaseStatus(): DatabaseStatus {
  return connectionStates[mongoose.connection.readyState] ?? "disconnected";
}

export async function connectToDatabase(uri: string): Promise<void> {
  await mongoose.connect(uri);
}