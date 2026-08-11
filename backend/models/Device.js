const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  deviceName: { type: String, required: true },
  reminderMode: { type: String, enum: ['iot', 'mobile'], default: 'iot' },
  connectionType: { type: String, default: 'WiFi' },
  status: { type: String, enum: ['online', 'offline'], default: 'offline' },
  lastSeen: { type: Date, default: Date.now },
  reminderActive: {
    type: Boolean,
    default: false
},

medicineName: {
    type: String,
    default: ""
},

reminderTime: {
    type: Date
},
  syncStatus: { type: String, enum: ['synced', 'pending_sync'], default: 'synced' }
}, { timestamps: true });

module.exports = mongoose.model('Device', deviceSchema);
