const cron = require('node-cron');
const Medicine = require('../models/Medicine');
const Device = require('../models/Device');
const twilio = require('twilio');
const DietPlan = require('../models/DietPlan');

// Initialize Twilio...
let twilioClient;

const initTwilio = () => {
  const sid = process.env.TWILIO_ACCOUNT_SID ? process.env.TWILIO_ACCOUNT_SID.trim() : '';
  const token = process.env.TWILIO_AUTH_TOKEN ? process.env.TWILIO_AUTH_TOKEN.trim() : '';

  if (!sid || !token || sid === 'your_twilio_account_sid') {
    console.warn("[Twilio] Account SID or Auth Token missing or default in .env");
    return;
  }

  try {
    twilioClient = twilio(sid, token);
    console.log("[Twilio] Initialized client successfully with SID:", sid);
  } catch (err) {
    console.error("[Twilio] Failed to initialize client:", err.message);
  }
};

// === ADD THIS HELPER FUNCTION HERE ===
const trimOldHistory = (medicine) => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  medicine.history = medicine.history.filter(h =>
    new Date(h.date) > thirtyDaysAgo
  );
};

// Helper function to format phone numbers to E.164 format (+91...)
const formatPhoneNumber = (phone) => {
  if (!phone) return '';
  let cleaned = String(phone).trim();
  if (!cleaned.startsWith('+')) {
    if (cleaned.length === 10) {
      cleaned = '+91' + cleaned;
    } else {
      cleaned = '+' + cleaned;
    }
  }
  return cleaned;
};

// Function to send SMS with robust error handling
const sendSMS = async (to, message) => {
  if (!twilioClient) {
    console.warn("[Twilio] Client not initialized. Skipping SMS.");
    return false;
  }

  const formattedTo = formatPhoneNumber(to);
  if (!formattedTo) {
    console.warn("[Twilio] Invalid phone number for SMS:", to);
    return false;
  }

  try {
    console.log(`[Twilio] Sending SMS to ${formattedTo}...`);
    const res = await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: formattedTo
    });
    console.log(`[Twilio] SMS sent successfully to ${formattedTo}. Message SID: ${res.sid}`);
    return true;
  } catch (error) {
    if (error.code === 20003 || error.status === 401) {
      console.error(`[Twilio Auth Error 20003] Authentication failed! Check TWILIO_ACCOUNT_SID (${process.env.TWILIO_ACCOUNT_SID}) & TWILIO_AUTH_TOKEN in backend/.env`);
    } else if (error.code === 21608) {
      console.error(`[Twilio Error 21608] The recipient number ${formattedTo} is unverified. For Twilio Trial accounts, add ${formattedTo} to Verified Caller IDs on the Twilio Console.`);
    } else {
      console.error(`[Twilio SMS Error ${error.code || error.status || 'UNKNOWN'}]:`, error.message);
    }
    return false;
  }
};

// Function to make voice call with robust error handling
const makeVoiceCall = async (to, message) => {
  if (!twilioClient) {
    console.warn("[Twilio] Client not initialized. Skipping Voice Call.");
    return false;
  }

  const formattedTo = formatPhoneNumber(to);
  if (!formattedTo) {
    console.warn("[Twilio] Invalid phone number for Call:", to);
    return false;
  }

  try {
    console.log(`[Twilio] Making voice call to ${formattedTo}...`);
    const res = await twilioClient.calls.create({
      twiml: `<Response><Say>${message}</Say></Response>`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: formattedTo
    });
    console.log(`[Twilio] Voice call initiated successfully to ${formattedTo}. Call SID: ${res.sid}`);
    return true;
  } catch (error) {
    if (error.code === 20003 || error.status === 401) {
      console.error(`[Twilio Auth Error 20003] Authentication failed! Check TWILIO_ACCOUNT_SID (${process.env.TWILIO_ACCOUNT_SID}) & TWILIO_AUTH_TOKEN in backend/.env`);
    } else if (error.code === 21608) {
      console.error(`[Twilio Error 21608] The recipient number ${formattedTo} is unverified. For Twilio Trial accounts, add ${formattedTo} to Verified Caller IDs on the Twilio Console.`);
    } else {
      console.error(`[Twilio Call Error ${error.code || error.status || 'UNKNOWN'}]:`, error.message);
    }
    return false;
  }
};


const sendDietPlanReminders = async (now) => {
  if (!twilioClient) return;

  const currentHours = now.getHours().toString().padStart(2, '0');
  const currentMinutes = now.getMinutes().toString().padStart(2, '0');
  const currentTimeStr = `${currentHours}:${currentMinutes}`;
  const todayStr = now.toISOString().split('T')[0]; // YYYY-MM-DD

  // Calculate tomorrow's date for breakfast/lunch scheduling (day before at 7pm)
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0]; // YYYY-MM-DD

  // 1. Breakfast and Lunch (Sent the day before at 7:00 PM)
  if (currentTimeStr === '19:00') {
    console.log(`[Scheduler] Checking for breakfast and lunch diet plan reminders to send for tomorrow (${tomorrowStr})...`);
    try {
      const plans = await DietPlan.find({ whatsappNumber: { $ne: '' } });
      for (const plan of plans) {
        if (plan.lastSentDates && plan.lastSentDates.breakfast_lunch === tomorrowStr) {
          continue; // Already sent
        }

        let fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_PHONE_NUMBER;
        if (fromNumber && !fromNumber.startsWith('whatsapp:')) {
          fromNumber = 'whatsapp:' + fromNumber;
        }

        let formattedNumber = plan.whatsappNumber;
        if (!formattedNumber.startsWith('whatsapp:')) {
          formattedNumber = 'whatsapp:' + formattedNumber;
        }

        // Send Breakfast Reminder (with Early Morning prep + Breakfast text, and breakfast image)
        const bMsg = plan.reminders?.breakfast || "Reminder: Prepare your breakfast and early morning prep items for tomorrow!";
        const bImgPrompt = plan.images?.breakfast;
        const bMediaUrl = bImgPrompt ? `https://image.pollinations.ai/prompt/${encodeURIComponent(bImgPrompt)}?width=512&height=512&nologo=true` : null;

        console.log(`[Scheduler] Sending breakfast reminder to ${formattedNumber}...`);
        await twilioClient.messages.create({
          body: bMsg,
          from: fromNumber,
          to: formattedNumber,
          ...(bMediaUrl ? { mediaUrl: [bMediaUrl] } : {})
        });

        // Send Lunch Reminder (with lunch image)
        const lMsg = plan.reminders?.lunch || "Reminder: Prepare your lunch for tomorrow!";
        const lImgPrompt = plan.images?.lunch;
        const lMediaUrl = lImgPrompt ? `https://image.pollinations.ai/prompt/${encodeURIComponent(lImgPrompt)}?width=512&height=512&nologo=true` : null;

        console.log(`[Scheduler] Sending lunch reminder to ${formattedNumber}...`);
        await twilioClient.messages.create({
          body: lMsg,
          from: fromNumber,
          to: formattedNumber,
          ...(lMediaUrl ? { mediaUrl: [lMediaUrl] } : {})
        });

        // Update database
        if (!plan.lastSentDates) plan.lastSentDates = {};
        plan.lastSentDates.breakfast_lunch = tomorrowStr;
        await plan.save();
      }
    } catch (err) {
      console.error("[Scheduler] Error in breakfast/lunch sending:", err);
    }
  }

  // 2. Snacks and Dinner (Sent the same day at 10:00 AM)
  if (currentTimeStr === '10:00') {
    console.log(`[Scheduler] Checking for snacks and dinner diet plan reminders to send for today (${todayStr})...`);
    try {
      const plans = await DietPlan.find({ whatsappNumber: { $ne: '' } });
      for (const plan of plans) {
        if (plan.lastSentDates && plan.lastSentDates.snacks_dinner === todayStr) {
          continue; // Already sent
        }

        let fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_PHONE_NUMBER;
        if (fromNumber && !fromNumber.startsWith('whatsapp:')) {
          fromNumber = 'whatsapp:' + fromNumber;
        }

        let formattedNumber = plan.whatsappNumber;
        if (!formattedNumber.startsWith('whatsapp:')) {
          formattedNumber = 'whatsapp:' + formattedNumber;
        }

        // Send Snacks Reminder (with snacks image)
        const sMsg = plan.reminders?.snacks || "Reminder: Here is your snack option for today!";
        const sImgPrompt = plan.images?.snacks;
        const sMediaUrl = sImgPrompt ? `https://image.pollinations.ai/prompt/${encodeURIComponent(sImgPrompt)}?width=512&height=512&nologo=true` : null;

        console.log(`[Scheduler] Sending snacks reminder to ${formattedNumber}...`);
        await twilioClient.messages.create({
          body: sMsg,
          from: fromNumber,
          to: formattedNumber,
          ...(sMediaUrl ? { mediaUrl: [sMediaUrl] } : {})
        });

        // Send Dinner Reminder (with dinner image)
        const dMsg = plan.reminders?.dinner || "Reminder: Here is your dinner option for tonight!";
        const dImgPrompt = plan.images?.dinner;
        const dMediaUrl = dImgPrompt ? `https://image.pollinations.ai/prompt/${encodeURIComponent(dImgPrompt)}?width=512&height=512&nologo=true` : null;

        console.log(`[Scheduler] Sending dinner reminder to ${formattedNumber}...`);
        await twilioClient.messages.create({
          body: dMsg,
          from: fromNumber,
          to: formattedNumber,
          ...(dMediaUrl ? { mediaUrl: [dMediaUrl] } : {})
        });

        // Update database
        if (!plan.lastSentDates) plan.lastSentDates = {};
        plan.lastSentDates.snacks_dinner = todayStr;
        await plan.save();
      }
    } catch (err) {
      console.error("[Scheduler] Error in snacks/dinner sending:", err);
    }
  }
};


const startScheduler = () => {
  initTwilio();

  // Run every minute
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      console.log("Scheduler Running:", now);
      await sendDietPlanReminders(now);

      // Device connectivity status updater (mark offline if > 2 mins inactive)
      try {
        const twoMinsAgo = new Date(Date.now() - 2 * 60 * 1000);
        await Device.updateMany(
          { status: 'online', lastSeen: { $lt: twoMinsAgo } },
          { $set: { status: 'offline' } }
        );
      } catch (devErr) {
        console.error("[Scheduler] Error updating device statuses:", devErr);
      }

      const currentHours = now.getHours().toString().padStart(2, '0');
      const currentMinutes = now.getMinutes().toString().padStart(2, '0');
      const currentTimeStr = `${currentHours}:${currentMinutes}`;
      const todayStr = now.toDateString();

      const activeMedicines = await Medicine.find({ status: 'active' });
      console.log("Medicines Found:", activeMedicines.length);

      for (const medicine of activeMedicines) {
        let todayHistory = medicine.history.find(h =>
          new Date(h.date).toDateString() === todayStr
        );
        console.log(
          "Medicine:",
          medicine.name,
          "| Medicine Time:",
          medicine.time,
          "| Current Time:",
          currentTimeStr,
          "| History Exists:",
          !!todayHistory
        );

        if (!todayHistory && currentTimeStr === medicine.time) {
          todayHistory = {
            date: now,
            alarmTime: now,
            status: 'pending',
            firstBuzzerDismissed: false,
            smsSent: false,
            callSent: false,
            emergencyCallSent: false
          };

          medicine.history.push(todayHistory);
          medicine.reminderStatus = 'ringing';

          // Activate IoT reminder
          const device = await Device.findOne({
            userId: medicine.userId,
            reminderMode: "iot",
            status: "online"
          });

          if (device) {
            device.reminderActive = true;
            device.medicineName = medicine.name;
            device.reminderTime = now;

            await device.save();

            console.log("IoT Reminder Activated for:", device.deviceId);
          }
        }

        if (!todayHistory) continue;

        if (todayHistory.status === 'taken') continue;

        // ... your existing time calculation logic ...

        if (todayHistory.alarmTime && todayHistory.status !== 'taken') {
          const alarmTime = new Date(todayHistory.alarmTime);
          const diffMinutes = Math.floor((now - alarmTime) / (1000 * 60));

          // 2 MINUTES → SMS only if first buzzer ignored
          if (
            diffMinutes >= 2 &&
            !todayHistory.smsSent &&
            !todayHistory.firstBuzzerDismissed &&
            todayHistory.status !== 'taken'
          ) {
            console.log("Sending SMS to patient:", medicine.phone);
            await sendSMS(
              medicine.phone,
              `Reminder: Please take your medicine ${medicine.name}`
            );

            todayHistory.smsSent = true;
          }

          // 9 MINUTES → Patient call if still not taken
          if (
            diffMinutes >= 9 &&
            !todayHistory.callSent &&
            todayHistory.status !== 'taken'
          ) {
            console.log("Calling patient:", medicine.phone);

            await makeVoiceCall(
              medicine.phone,
              `Reminder. Please confirm taking your medicine ${medicine.name}`
            );

            todayHistory.callSent = true;
          }

          // 11 MINUTES → Emergency call
          if (
            diffMinutes >= 11 &&
            !todayHistory.emergencyCallSent &&
            todayHistory.status !== 'taken'
          ) {
            console.log("Calling emergency contact:", medicine.emergencyPhone);

            await makeVoiceCall(
              medicine.emergencyPhone,
              `Emergency alert. The patient has not confirmed taking ${medicine.name}`
            );

            todayHistory.emergencyCallSent = true;
          }

          // 15 MINUTES → Mark missed
          if (
            diffMinutes >= 15 &&
            todayHistory.status !== 'taken'
          ) {
            todayHistory.status = 'missed';
          }
        }

        // === IMPORTANT: ADD trimOldHistory BEFORE SAVING ===
        trimOldHistory(medicine);
        medicine.history.forEach(h => {
          if (h.status === 'upcoming') {
            h.status = 'pending';
          }
        });
        await medicine.save();
      }
    } catch (error) {
      console.error('Scheduler error:', error);
    }
  });

  console.log('Scheduler started.');
};

module.exports = { startScheduler };