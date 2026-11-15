import { Schema, model, models, type Model, type Types } from "mongoose";
import {
  BOOKING_SOURCES,
  BOOKING_STATUSES,
  BOOKING_TYPES,
  type BookingSource,
  type BookingStatus,
  type BookingType,
} from "@/lib/booking/types";

export interface BookingCustomer {
  userId?: Types.ObjectId;
  name: string;
  phone: string;
  email?: string;
}

export interface BookingHistoryEntry {
  at: Date;
  /** Who made the change: "customer", "staff:<userId>", "owner:<userId>" or "system". */
  by: string;
  from: BookingStatus | null;
  to: BookingStatus;
  note?: string;
}

export interface BookingRecord {
  _id: Types.ObjectId;
  code: string;
  type: BookingType;
  resourceIds: Types.ObjectId[];
  start: Date;
  end: Date;
  status: BookingStatus;
  /** Snapshot at booking time, so later profile edits do not rewrite history. */
  customer: BookingCustomer;
  partySize?: number;
  notes?: string;
  source: BookingSource;
  priceEstimate: number;
  quotedPrice?: number;
  /** SHA-256 of the token in the customer's manage link. The token itself is never stored. */
  manageTokenHash: string;
  history: BookingHistoryEntry[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const customerSchema = new Schema<BookingCustomer>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
  },
  { _id: false },
);

const historySchema = new Schema<BookingHistoryEntry>(
  {
    at: { type: Date, required: true },
    by: { type: String, required: true },
    from: { type: String, enum: [...BOOKING_STATUSES, null], default: null },
    to: { type: String, enum: BOOKING_STATUSES, required: true },
    note: { type: String },
  },
  { _id: false },
);

const bookingSchema = new Schema<BookingRecord>(
  {
    code: { type: String, required: true, unique: true },
    type: { type: String, enum: BOOKING_TYPES, required: true },
    resourceIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "Resource" }],
      required: true,
      validate: (ids: unknown[]) => ids.length > 0,
    },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    status: { type: String, enum: BOOKING_STATUSES, required: true },
    customer: { type: customerSchema, required: true },
    partySize: { type: Number, min: 1 },
    notes: { type: String },
    source: { type: String, enum: BOOKING_SOURCES, required: true },
    priceEstimate: { type: Number, required: true, min: 0 },
    quotedPrice: { type: Number, min: 0 },
    manageTokenHash: { type: String, required: true },
    history: { type: [historySchema], required: true },
    createdBy: { type: String, required: true },
  },
  { timestamps: true, collection: "bookings" },
);

bookingSchema.index({ start: 1, end: 1 });
bookingSchema.index({ status: 1, start: 1 });
bookingSchema.index({ "customer.userId": 1, start: -1 });
bookingSchema.index({ "customer.email": 1, start: -1 });
bookingSchema.index({ status: 1, "history.0.at": 1 });

export const Booking: Model<BookingRecord> =
  (models.Booking as Model<BookingRecord>) ?? model<BookingRecord>("Booking", bookingSchema);
