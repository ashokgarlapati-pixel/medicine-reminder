const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/deviceController');

// Device management endpoints
router.post('/register', deviceController.registerDevice);
router.get('/user/:userId', deviceController.getUserDevices);
router.delete('/:deviceId', deviceController.disconnectDevice);

// ESP32 device interaction endpoints
router.post('/heartbeat', deviceController.heartbeat);
router.get('/sync/:deviceId', deviceController.syncSchedule);
router.post('/acknowledge', deviceController.acknowledgeReminder);

// NEW API
router.get('/reminder/:deviceId', deviceController.getReminder);

router.get('/test', (req, res) => {
    res.json({
        success: true,
        message: 'ESP32 Connected Successfully'
    });
});

module.exports = router;