import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

export const RESOURCE_TYPES = ["pc", "console"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

const resourceSchema = new Schema(
  {
    type: { type: String, enum: RESOURCE_TYPES, required: true },
    name: { type: String, required: true, unique: true, trim: true },
    zone: { type: String },
    specs: { type: String },
    hourlyRate: { type: Number, required: true, min: 0 }, // in settings.currency; 0 = not set yet
    bookableOnline: { type: Boolean, required: true },
    active: { type: Boolean, required: true, default: true },
    sortOrder: { type: Number, required: true },
  },
  { timestamps: true, collection: "resources" },
);

resourceSchema.index({ active: 1, sortOrder: 1 });

export type ResourceDoc = InferSchemaType<typeof resourceSchema>;

export const Resource: Model<ResourceDoc> =
  (models.Resource as Model<ResourceDoc>) ?? model<ResourceDoc>("Resource", resourceSchema);
