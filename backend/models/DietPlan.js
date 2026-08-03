const mongoose = require('mongoose');

const dietPlanSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  whatsappNumber: { type: String, required: true },
  summary: {
    detectedConditions: [String],
    riskLevel: String,
    keyObservations: [String]
  },
  dietPlan: {
    earlyMorning: {
      foodItems: [String],
      portionSizes: [String],
      calories: { type: Number, default: 0 }
    },
    morning: {
      foodItems: [String],
      portionSizes: [String],
      calories: { type: Number, default: 0 }
    },
    afternoon: {
      foodItems: [String],
      portionSizes: [String],
      calories: { type: Number, default: 0 }
    },
    snacks: {
      foodItems: [String],
      portionSizes: [String],
      calories: { type: Number, default: 0 }
    },
    night: {
      foodItems: [String],
      portionSizes: [String],
      calories: { type: Number, default: 0 }
    }
  },
  reminders: {
    breakfast: String,
    lunch: String,
    snacks: String,
    dinner: String
  },
  images: {
    breakfast: String,
    lunch: String,
    snacks: String,
    dinner: String
  },
  restrictions: [String],
  hydration: String,
  notes: String,
  totalCalories: Number,
  lastSentDates: {
    breakfast_lunch: { type: String, default: '' }, // format: YYYY-MM-DD
    snacks_dinner: { type: String, default: '' }    // format: YYYY-MM-DD
  }
}, { timestamps: true });

module.exports = mongoose.model('DietPlan', dietPlanSchema);
