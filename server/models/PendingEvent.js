import mongoose from "mongoose";

const schema = new mongoose.Schema({
    name: { type: String, required: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
    lastAttemptAt: { type: Date, default: null },
}, { timestamps: true });

export default mongoose.models.PendingEvent || mongoose.model("PendingEvent", schema);
