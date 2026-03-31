import mongoose from "mongoose";

const globalRef = globalThis;
if (!globalRef._mongoose) {
  globalRef._mongoose = { conn: null, promise: null };
}

/** Reuse connection across serverless invocations (Vercel). */
export async function connectDB() {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    throw new Error("MONGODB_URI is not set");
  }
  if (globalRef._mongoose.conn) {
    return globalRef._mongoose.conn;
  }
  if (!globalRef._mongoose.promise) {
    globalRef._mongoose.promise = mongoose.connect(uri, {
      bufferCommands: false,
      maxPoolSize: 5,
    });
  }
  try {
    globalRef._mongoose.conn = await globalRef._mongoose.promise;
  } catch (e) {
    globalRef._mongoose.promise = null;
    throw e;
  }
  return globalRef._mongoose.conn;
}
