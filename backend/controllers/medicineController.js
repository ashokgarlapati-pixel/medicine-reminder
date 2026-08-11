const Medicine = require('../models/Medicine');
const Device = require('../models/Device');

// Add a new medicine
exports.addMedicine = async (req, res) => {
  try {
    const { userId, name, time, duration, phone, emergencyPhone, photo, reminderMode, deviceId } = req.body;

    if (!userId || !name || !time || !duration) {
      return res.status(400).json({ error: 'Required fields are missing' });
    }

    const newMedicine = new Medicine({
      userId,
      name,
      time,
      duration: parseInt(duration, 10),
      phone: phone || '',
      emergencyPhone: emergencyPhone || '',
      photo,
      reminderMode: reminderMode || 'mobile',
      deviceId: deviceId || ''
    });

    await newMedicine.save();

    res.status(201).json({
      message: 'Medicine added successfully',
      medicine: newMedicine
    });
  } catch (error) {
    console.error('Error adding medicine:', error);
    res.status(500).json({ error: 'Failed to add medicine' });
  }
};

// Get medicines for a user - OPTIMIZED
exports.getMedicines = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'UserId is required' });
    }

    const medicines = await Medicine.find({
      userId,
      status: { $ne: 'deleted' }
    })
      .select('name time duration phone emergencyPhone photo startDate endDate status reminderMode deviceId syncStatus reminderStatus history')
      .lean()
      .sort({ createdAt: -1 });

    res.status(200).json(medicines);
  } catch (error) {
    console.error('Error fetching medicines:', error);
    res.status(500).json({ error: 'Failed to fetch medicines' });
  }
};

// Confirm medicine taken
exports.confirmMedicine = async (req, res) => {
  try {
    const { medicineId } = req.params;
    const today = new Date().toDateString();

    const medicine = await Medicine.findById(medicineId);

    if (!medicine) {
      return res.status(404).json({
        error: 'Medicine not found'
      });
    }

    let historyIndex = medicine.history.findIndex(
      h => new Date(h.date).toDateString() === today
    );

    if (historyIndex === -1) {
      medicine.history.push({
        date: new Date(),
        alarmTime: new Date(),
        status: 'taken',
        takenAt: new Date(),
        firstBuzzerDismissed: true
      });
    } else {
      const todayHistory = medicine.history[historyIndex];
      todayHistory.status = 'taken';
      todayHistory.takenAt = new Date();
      todayHistory.firstBuzzerDismissed = true;
    }

    medicine.reminderStatus = 'taken';
    await medicine.save();

    // Reset IoT Device active reminder state if applicable
    try {
      if (medicine.deviceId) {
        await Device.updateOne({ deviceId: medicine.deviceId }, { $set: { reminderActive: false, medicineName: '' } });
      }
      await Device.updateMany({ userId: medicine.userId }, { $set: { reminderActive: false, medicineName: '' } });
    } catch (devErr) {
      console.error("Error resetting device active status:", devErr);
    }

    res.status(200).json({
      message: 'Medicine marked as taken'
    });

  } catch (error) {
    console.error('Error confirming medicine:', error);
    res.status(500).json({
      error: 'Failed to confirm medicine'
    });
  }
};

// Dismiss medicine
exports.dismissMedicine = async (req, res) => {
  try {
    const { medicineId } = req.params;
    const today = new Date().toDateString();

    const medicine = await Medicine.findById(medicineId);

    if (!medicine) {
      return res.status(404).json({ error: 'Medicine not found' });
    }

    let todayHistory = medicine.history.find(
      h => new Date(h.date).toDateString() === today
    );

    if (!todayHistory) {
      todayHistory = {
        date: new Date(),
        alarmTime: new Date(),
        status: 'pending',
        firstBuzzerDismissed: true
      };

      medicine.history.push(todayHistory);
    } else {
      todayHistory.status = 'pending';
      todayHistory.firstBuzzerDismissed = true;

      if (!todayHistory.alarmTime) {
        todayHistory.alarmTime = new Date();
      }
    }

    await medicine.save();

    res.status(200).json({
      message: 'Reminder snoozed until second buzzer'
    });

  } catch (error) {
    console.error('Error dismissing medicine:', error);
    res.status(500).json({
      error: 'Failed to dismiss medicine'
    });
  }
};

// Delete medicine
exports.deleteMedicine = async (req, res) => {
  try {
    const { medicineId } = req.params;
    const deleted = await Medicine.findByIdAndDelete(medicineId);

    if (!deleted) {
      return res.status(404).json({ error: 'Medicine not found' });
    }

    res.status(200).json({ message: 'Medicine deleted successfully' });
  } catch (error) {
    console.error('Error deleting medicine:', error);
    res.status(500).json({ error: 'Failed to delete medicine' });
  }
};