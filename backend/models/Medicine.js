const mongoose = require('mongoose');

const medicineSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  name: { type: String, required: true },
  time: { type: String, required: true }, // Format HH:mm
  duration: { type: Number, required: true }, // in days
  phone: { type: String, required: false, default: '' },
  emergencyPhone: { type: String, required: false, default: '' },
  photo: { type: String },
  startDate: { type: Date, default: Date.now },
  endDate: { type: Date },
  status: { type: String, enum: ['active', 'completed', 'deleted'], default: 'active' },
  history: [{
    date: { type: Date, default: Date.now },
    status: { type: String, enum: ['pending', 'taken', 'missed', 'deleted'], default: 'pending' }, takenAt: { type: Date },
    alarmTime: { type: Date },
    smsSent: { type: Boolean, default: false },
    callSent: { type: Boolean, default: false },
    firstBuzzerDismissed: { type: Boolean, default: false },
    emergencyCallSent: { type: Boolean, default: false }
  }]
}, { timestamps: true });

// Pre-save to calculate end date and initialize history if needed
medicineSchema.pre('save', function () {
  if (this.isNew) {
    const end = new Date(this.startDate);
    // Ensure duration is parsed as integer to avoid string concatenation issues
    end.setDate(end.getDate() + parseInt(this.duration, 10));
    this.endDate = end;

    // Initialize today's history if not present
    this.history.push({
      date: new Date(),
      status: 'pending',
      alarmTime: new Date(),
      smsSent: false,
      callSent: false,
      firstBuzzerDismissed: false,
      emergencyCallSent: false
    });
  }
});

module.exports = mongoose.model('Medicine', medicineSchema);
