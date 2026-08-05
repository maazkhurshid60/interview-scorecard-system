const mongoose = require('mongoose');
const { AUDIT_ACTIONS } = require('../utils/constants');


const auditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    enum: AUDIT_ACTIONS,
    required: true, index: true,
  },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  requisitionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Requisition', index: true },
  applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', index: true },
  targetType: String,          // 'interview', 'score', 'scorecard', 'setting', ...
  targetId: String,
  oldValue: mongoose.Schema.Types.Mixed,
  newValue: mongoose.Schema.Types.Mixed,
  reason: String,
  timestamp: { type: Date, default: Date.now, index: true },
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
