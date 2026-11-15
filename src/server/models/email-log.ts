import { Schema, model, models, type Model, type Types } from "mongoose";

export const EMAIL_TEMPLATES = [
  "login_code",
  "booking_confirmed",
  "lan_requested",
  "lan_request_owner",
  "lan_approved",
  "lan_rejected",
] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

export const EMAIL_STATUSES = ["pending", "sent", "failed"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

/**
 * One row per email the system tried to send. It never stores the content,
 * so login codes do not end up in the database.
 */
export interface EmailLogRecord {
  _id: Types.ObjectId;
  bookingId?: Types.ObjectId;
  to: string;
  template: EmailTemplate;
  /** Set for emails that must go out at most once, e.g. a booking's confirmation. */
  dedupeKey?: string;
  status: EmailStatus;
  providerId?: string;
  error?: string;
  requestedAt: Date;
  sentAt?: Date;
}

const emailLogSchema = new Schema<EmailLogRecord>(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: "Booking" },
    to: { type: String, required: true, lowercase: true, trim: true },
    template: { type: String, enum: EMAIL_TEMPLATES, required: true },
    dedupeKey: { type: String },
    status: { type: String, enum: EMAIL_STATUSES, required: true },
    providerId: { type: String },
    error: { type: String },
    requestedAt: { type: Date, required: true },
    sentAt: { type: Date },
  },
  { collection: "emailLog" },
);

emailLogSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });
emailLogSchema.index({ to: 1, template: 1, requestedAt: -1 });
emailLogSchema.index({ bookingId: 1 });

export const EmailLog: Model<EmailLogRecord> =
  (models.EmailLog as Model<EmailLogRecord>) ?? model<EmailLogRecord>("EmailLog", emailLogSchema);
