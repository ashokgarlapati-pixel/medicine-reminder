const Device = require('../models/Device');
const Medicine = require('../models/Medicine');

// Register a new device for caregiver
exports.registerDevice = async (req, res) => {
  try {
    const { deviceId, userId, deviceName, reminderMode, connectionType } = req.body;

    if (!deviceId || !userId || !deviceName) {
      return res.status(400).json({ error: 'deviceId, userId, and deviceName are required' });
    }

    let existingDevice = await Device.findOne({ deviceId });
    if (existingDevice) {
      existingDevice.userId = userId;
      existingDevice.deviceName = deviceName;
      if (reminderMode) existingDevice.reminderMode = reminderMode;
      if (connectionType) existingDevice.connectionType = connectionType;
      existingDevice.status = 'online';
      existingDevice.lastSeen = new Date();
      await existingDevice.save();

      return res.status(200).json({
        message: 'Device updated successfully',
        device: existingDevice
      });
    }

    const newDevice = new Device({
      deviceId,
      userId,
      deviceName,
      reminderMode: reminderMode || 'iot',
      connectionType: connectionType || 'WiFi',
      status: 'online',
      lastSeen: new Date(),
      syncStatus: 'synced'
    });

    await newDevice.save();

    res.status(201).json({
      message: 'Device registered successfully',
      device: newDevice
    });
  } catch (error) {
    console.error('Error registering device:', error);
    res.status(500).json({ error: 'Failed to register device' });
  }
};

// Get devices for a user
exports.getUserDevices = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const devices = await Device.find({ userId }).sort({ createdAt: -1 });

    // Mark devices offline if lastSeen > 2 minutes
    const now = Date.now();
    const updatedDevices = devices.map(device => {
      const devObj = device.toObject();
      if (devObj.lastSeen && (now - new Date(devObj.lastSeen).getTime() > 2 * 60 * 1000)) {
        devObj.status = 'offline';
      }
      return devObj;
    });

    res.status(200).json(updatedDevices);
  } catch (error) {
    console.error('Error fetching user devices:', error);
    res.status(500).json({ error: 'Failed to fetch user devices' });
  }
};

// Disconnect / Delete device
exports.disconnectDevice = async (req, res) => {
  try {
    const { deviceId } = req.params;

    const deleted = await Device.findOneAndDelete({ deviceId });
    if (!deleted) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Unassign medicines attached to this device
    await Medicine.updateMany({ deviceId }, { $set: { deviceId: '', reminderMode: 'mobile' } });

    res.status(200).json({ message: 'Device disconnected successfully' });
  } catch (error) {
    console.error('Error disconnecting device:', error);
    res.status(500).json({ error: 'Failed to disconnect device' });
  }
};

// ESP32 Heartbeat endpoint
exports.heartbeat = async (req, res) => {
  try {
    const { deviceId } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId is required' });
    }

    const device = await Device.findOne({ deviceId });
    if (!device) {
      return res.status(404).json({ error: 'Device not registered' });
    }

    device.status = 'online';
    device.lastSeen = new Date();
    await device.save();

    res.status(200).json({ status: 'ok', serverTime: new Date().toISOString() });
  } catch (error) {
    console.error('Heartbeat error:', error);
    res.status(500).json({ error: 'Heartbeat failed' });
  }
};

// ESP32 Schedule Sync endpoint (fetches active medicines for this device)
exports.syncSchedule = async (req, res) => {
  try {
    const { deviceId } = req.params;

    const device = await Device.findOne({ deviceId });
    if (device) {
      device.status = 'online';
      device.lastSeen = new Date();
      device.syncStatus = 'synced';
      await device.save();
    }

    // Find medicines associated with this device or user's IoT mode medicines
    let medicines = [];
    if (device) {
      medicines = await Medicine.find({
        status: 'active',
        $or: [
          { deviceId: deviceId },
          { userId: device.userId, reminderMode: 'iot' }
        ]
      }).select('name time duration status reminderMode deviceId history').lean();
    } else {
      medicines = await Medicine.find({
        status: 'active',
        deviceId: deviceId
      }).select('name time duration status reminderMode deviceId history').lean();
    }

    const todayStr = new Date().toDateString();

    const schedulePayload = medicines.map(med => {
      let todayHistory = med.history ? med.history.find(h => new Date(h.date).toDateString() === todayStr) : null;
      return {
        id: med._id,
        name: med.name,
        time: med.time,
        status: todayHistory ? todayHistory.status : 'pending'
      };
    });

    res.status(200).json({
      deviceId,
      count: schedulePayload.length,
      schedule: schedulePayload,
      serverTime: new Date().toISOString()
    });
  } catch (error) {
    console.error('Sync schedule error:', error);
    res.status(500).json({ error: 'Failed to sync schedule' });
  }
};

// ESP32 Acknowledge endpoint (button pressed -> taken, or timeout -> missed)
exports.acknowledgeReminder = async (req, res) => {
  try {
    const { deviceId, medicineId, status } = req.body;

    if (!medicineId || !status) {
      return res.status(400).json({ error: 'medicineId and status are required' });
    }

    const medicine = await Medicine.findById(medicineId);
    if (!medicine) {
      return res.status(404).json({ error: 'Medicine not found' });
    }

    const today = new Date().toDateString();
    let historyIndex = medicine.history.findIndex(
      h => new Date(h.date).toDateString() === today
    );

    if (historyIndex === -1) {
      medicine.history.push({
        date: new Date(),
        alarmTime: new Date(),
        status: status === 'taken' ? 'taken' : 'missed',
        takenAt: status === 'taken' ? new Date() : undefined,
        firstBuzzerDismissed: true
      });
    } else {
      const todayHistory = medicine.history[historyIndex];
      todayHistory.status = status === 'taken' ? 'taken' : 'missed';
      if (status === 'taken') {
        todayHistory.takenAt = new Date();
      }
      todayHistory.firstBuzzerDismissed = true;
    }

    medicine.reminderStatus = status;
    await medicine.save();

    // Also update device lastSeen
    if (deviceId) {
      await Device.updateOne({ deviceId }, { $set: { status: 'online', lastSeen: new Date() } });
    }

    res.status(200).json({
      message: `Reminder acknowledged as ${status}`,
      medicineId: medicine._id,
      status
    });
  } catch (error) {
    console.error('Error acknowledging reminder:', error);
    res.status(500).json({ error: 'Failed to acknowledge reminder' });
  }
};

// ===============================
// ESP32 - Get Active Reminder
// ===============================
exports.getReminder = async (req, res) => {
  try {
    const { deviceId } = req.params;

    const device = await Device.findOne({ deviceId });

    if (!device) {
      return res.status(404).json({
        active: false,
        message: "Device not found"
      });
    }

    // Update device status
    device.status = "online";
    device.lastSeen = new Date();
    await device.save();

    res.status(200).json({
      active: device.reminderActive,
      medicine: device.medicineName,
      reminderTime: device.reminderTime
    });

  } catch (error) {
    console.error("Get Reminder Error:", error);

    res.status(500).json({
      active: false,
      error: "Failed to fetch reminder"
    });
  }
};