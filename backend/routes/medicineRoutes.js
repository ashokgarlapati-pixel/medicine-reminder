const express = require('express');
const router = express.Router();
const medicineController = require('../controllers/medicineController');

// Routes
router.post('/add', medicineController.addMedicine);
router.get('/:userId', medicineController.getMedicines);
router.put('/:medicineId/confirm', medicineController.confirmMedicine);
router.put('/:medicineId/dismiss', medicineController.dismissMedicine);
router.delete('/:medicineId', medicineController.deleteMedicine);

module.exports = router;
