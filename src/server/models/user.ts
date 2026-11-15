import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

export const USER_ROLES = ["customer", "staff", "owner"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Milestone 3 wires this collection to the auth library (email one-time code).
 * Until then it only holds the seeded owner.
 */
const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, default: "" },
    phone: { type: String, default: "" },
    role: { type: String, enum: USER_ROLES, required: true, default: "customer" },
    noShowCount: { type: Number, required: true, default: 0, min: 0 },
    blocked: { type: Boolean, required: true, default: false },
  },
  { timestamps: true, collection: "users" },
);

export type UserDoc = InferSchemaType<typeof userSchema>;

export const User: Model<UserDoc> =
  (models.User as Model<UserDoc>) ?? model<UserDoc>("User", userSchema);
