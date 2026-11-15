import { Schema, model, models, type Model, type Types } from "mongoose";

/**
 * One document per station per slot held by an active booking.
 *
 * The unique index on (resourceId, slotStart) is what makes double bookings
 * impossible: two bookings for the same station and slot cannot both insert
 * their lock. Only src/server/booking-service.ts writes this collection.
 */
export interface SlotLockRecord {
  _id: Types.ObjectId;
  resourceId: Types.ObjectId;
  slotStart: Date;
  bookingId: Types.ObjectId;
}

const slotLockSchema = new Schema<SlotLockRecord>(
  {
    resourceId: { type: Schema.Types.ObjectId, ref: "Resource", required: true },
    slotStart: { type: Date, required: true },
    bookingId: { type: Schema.Types.ObjectId, ref: "Booking", required: true },
  },
  { collection: "slotLocks" },
);

slotLockSchema.index({ resourceId: 1, slotStart: 1 }, { unique: true });
slotLockSchema.index({ bookingId: 1 });

export const SlotLock: Model<SlotLockRecord> =
  (models.SlotLock as Model<SlotLockRecord>) ?? model<SlotLockRecord>("SlotLock", slotLockSchema);
