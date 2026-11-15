import mongoose from "mongoose";
import { getEnv } from "@/lib/env";

/**
 * One shared Mongoose connection per server instance. Cached on globalThis so
 * dev hot reloads and serverless warm starts reuse it instead of opening a new
 * pool on every invocation.
 */
const globalForDb = globalThis as unknown as {
  __mongoose?: Promise<typeof mongoose>;
};

export function connectDb(uri?: string): Promise<typeof mongoose> {
  if (!globalForDb.__mongoose) {
    globalForDb.__mongoose = mongoose
      .connect(uri ?? getEnv().MONGODB_URI, { serverSelectionTimeoutMS: 8000 })
      .catch((error) => {
        globalForDb.__mongoose = undefined;
        throw error;
      });
  }
  return globalForDb.__mongoose;
}

export async function disconnectDb(): Promise<void> {
  globalForDb.__mongoose = undefined;
  await mongoose.disconnect();
}
