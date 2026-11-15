import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const openingHoursSchema = new Schema(
  {
    weekday: { type: Number, required: true, min: 0, max: 6 }, // 0 = Sunday
    open: { type: String, required: true, match: /^\d{2}:\d{2}$/ },
    close: { type: String, required: true, match: /^\d{2}:\d{2}$/ }, // close < open = next day
  },
  { _id: false },
);

const stationRulesSchema = new Schema(
  {
    minMinutes: { type: Number, required: true },
    maxMinutes: { type: Number, required: true },
    minLeadMinutes: { type: Number, required: true },
    maxAdvanceDays: { type: Number, required: true },
    cancelCutoffMinutes: { type: Number, required: true },
    maxStationsPerBooking: { type: Number, required: true },
  },
  { _id: false },
);

const venueRulesSchema = new Schema(
  {
    minMinutes: { type: Number, required: true },
    minLeadHours: { type: Number, required: true },
    maxAdvanceDays: { type: Number, required: true },
    cancelCutoffHours: { type: Number, required: true },
    approvalTimeoutHours: { type: Number, required: true },
    bufferMinutes: { type: Number, required: true },
  },
  { _id: false },
);

const settingsSchema = new Schema(
  {
    // Single-venue app: exactly one settings document, keyed "default".
    key: { type: String, required: true, unique: true, default: "default" },
    venueName: { type: String, required: true },
    address: { type: String, default: "" },
    timezone: { type: String, required: true },
    currency: { type: String, required: true },
    locale: { type: String, required: true },
    slotMinutes: { type: Number, required: true },
    openingHours: { type: [openingHoursSchema], required: true },
    station: { type: stationRulesSchema, required: true },
    venue: { type: venueRulesSchema, required: true },
    graceMinutes: { type: Number, required: true },
    maxUpcomingPerCustomer: { type: Number, required: true },
    noShowLimit: { type: Number, required: true },
  },
  { timestamps: true, collection: "settings" },
);

export type SettingsDoc = InferSchemaType<typeof settingsSchema>;

export const Settings: Model<SettingsDoc> =
  (models.Settings as Model<SettingsDoc>) ?? model<SettingsDoc>("Settings", settingsSchema);
