import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { ROLES } from "@/lib/auth/roles";

export const USER_ROLES = ROLES;
export type { Role as UserRole } from "@/lib/auth/roles";

/**
 * The `users` collection is shared with the auth library (see src/server/auth.ts),
 * which creates a user the first time an email address logs in and maintains
 * `emailVerified`, `image`, `createdAt` and `updatedAt`. The other fields are
 * ours; none of them can be set by the client through the auth API.
 */
const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    emailVerified: { type: Boolean, default: false },
    name: { type: String, default: "" },
    image: { type: String },
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
