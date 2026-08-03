const cron = require('node-cron');
const Medicine = require('../models/Medicine');
const twilio = require('twilio');
const DietPlan = require('../models/DietPlan');

// Initialize Twilio...
let twilioClient;

const initTwilio = () => {
  twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

  console.log("Twilio initialized successfully");
};

// === ADD THIS HELPER FUNCTION HERE ===
const trimOldHistory = (medicine) => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  medicine.history = medicine.history.filter(h =>
    new Date(h.date) > thirtyDaysAgo
  );
};

// Function to send SMS...
const sendSMS = async (to, message) => {

  if (!twilioClient) return;

  console.log("Sending SMS to:", to);
  return twilioClient.messages.create({
    body: message,
    from: process.env.TWILIO_PHONE_NUMBER,
    to
  });
};

// Function to make voice call...
const makeVoiceCall = async (to, message) => {

  if (!twilioClient) return;

  console.log("Making call to:", to);

  return twilioClient.calls.create({
    twiml: `<Response><Say>${message}</Say></Response>`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to
  });
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
      await sendDietPlanReminders(now);
      const currentHours = now.getHours().toString().padStart(2, '0');
      const currentMinutes = now.getMinutes().toString().padStart(2, '0');
      const currentTimeStr = `${currentHours}:${currentMinutes}`;
      const todayStr = now.toDateString();

      const activeMedicines = await Medicine.find({ status: 'active' });

      for (const medicine of activeMedicines) {
        let todayHistory = medicine.history.find(h =>
          new Date(h.date).toDateString() === todayStr
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