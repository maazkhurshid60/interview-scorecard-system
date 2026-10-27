import mongoose from 'mongoose';

const settingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: mongoose.Schema.Types.Mixed,
  description: String,
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model('Setting', settingSchema);
