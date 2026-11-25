const cron = require('node-cron');
const Medicine = require('../models/Medicine');
const Device = require('../models/Device');
const twilio = require('twilio');
const DietPlan = require('../models/DietPlan');

// Official Twilio Trial Predefined SMS Template Identifiers
// Source: https://www.twilio.com/docs/usage/trials/try-out-sms
const PREDEFINED_TRIAL_SMS_TEMPLATES = Object.freeze([
  'sms_2fa',
  'sms_appointment_reminders',
  'sms_order_confirmation',
  'sms_delivery_updates',
  'sms_customer_support',
  'sms_marketing_promotions',
  'sms_event_notifications',
  'sms_account_alerts',
  'sms_feedback_surveys',
  'sms_internal_alerts'
]);

const DEFAULT_TRIAL_SMS_TEMPLATE = 'sms_appointment_reminders';

// Official Twilio Trial Voice Template Webhook URLs
// Source: https://www.twilio.com/docs/usage/trials/try-out-voice
const PREDEFINED_TRIAL_VOICE_URLS = Object.freeze([
  'https://webhooks.twilio.com/v1/Voice/Template/voice_text_to_speech',
  'https://webhooks.twilio.com/v1/Voice/Template/voice_speech_recognition',
  'https://webhooks.twilio.com/v1/Voice/Template/voice_keyboard_input',
  'https://webhooks.twilio.com/v1/Voice/Template/voice_play_audio'
]);

const DEFAULT_TRIAL_VOICE_URL = 'https://webhooks.twilio.com/v1/Voice/Template/voice_text_to_speech';

// Twilio error codes that are permanent/non-retryable without console/config changes
const NON_RETRYABLE_TWILIO_CODES = new Set([
  20003, // Auth failed
  21211, // Invalid 'To' phone number
  21212, // Invalid 'From' phone number
  21219, // Unverified recipient (trial)
  21608, // Unverified recipient (trial)
  572002, // No Twilio trial phone number assigned for messaging to destination
  572006, // Invalid template name on trial SMS
  573002, // No Twilio trial phone number assigned for voice to destination
  63007, // WhatsApp sender not configured
  63016  // WhatsApp outside 24h window / template required
]);

// Initialize Twilio...
let twilioClient;
let twilioAccountType = 'Trial';
let isSchedulerTickRunning = false;

// In-memory guards to prevent concurrent duplicates and repeated spam on permanent errors
const inFlightNotifications = new Set();
const terminalFailureCache = new Set();

const setTwilioClientForTesting = (client, accountType = 'Trial') => {
  twilioClient = client;
  twilioAccountType = accountType;
};

const clearNotificationGuardsForTesting = () => {
  inFlightNotifications.clear();
  terminalFailureCache.clear();
};

const initTwilio = async () => {
  const sid = process.env.TWILIO_ACCOUNT_SID ? process.env.TWILIO_ACCOUNT_SID.trim() : '';
  const token = process.env.TWILIO_AUTH_TOKEN ? process.env.TWILIO_AUTH_TOKEN.trim() : '';

  if (!sid || !token || sid === 'your_twilio_account_sid') {
    console.warn('[Twilio] Account SID or Auth Token missing or default in .env');
    return null;
  }

  try {
    twilioClient = twilio(sid, token);
    const maskedSid = sid.length > 8 ? `${sid.slice(0, 6)}...${sid.slice(-4)}` : '***';
    console.log('[Twilio] Initialized client successfully with SID:', maskedSid);

    // Best-effort account type check so logs reflect Trial vs Full mode
    if (twilioClient.api?.v2010?.accounts) {
      try {
        const account = await twilioClient.api.v2010.accounts(sid).fetch();
        if (account && account.type) {
          twilioAccountType = account.type;
          console.log(`[Twilio] Account type detected: ${twilioAccountType} (status: ${account.status})`);
        }
      } catch (accErr) {
        console.warn('[Twilio] Could not fetch account type; assuming Trial mode:', accErr.message);
      }
    }

    return twilioClient;
  } catch (err) {
    console.error('[Twilio] Failed to initialize client:', err.message);
    return null;
  }
};

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
  if (cleaned.toLowerCase().startsWith('whatsapp:')) {
    cleaned = cleaned.slice('whatsapp:'.length).trim();
  }
  if (!cleaned) return '';
  cleaned = cleaned.replace(/[\s()-]/g, '');
  if (!cleaned.startsWith('+')) {
    if (cleaned.length === 10) {
      cleaned = '+91' + cleaned;
    } else {
      cleaned = '+' + cleaned;
    }
  }
  return /^\+[1-9]\d{6,14}$/.test(cleaned) ? cleaned : '';
};

const formatWhatsAppAddress = (phone) => {
  const formatted = formatPhoneNumber(phone);
  return formatted ? `whatsapp:${formatted}` : '';
};

const resolveTrialSmsTemplate = (requestedTemplate) => {
  const candidate = (
    requestedTemplate ||
    process.env.TWILIO_TRIAL_SMS_TEMPLATE ||
    DEFAULT_TRIAL_SMS_TEMPLATE
  ).trim();

  if (!PREDEFINED_TRIAL_SMS_TEMPLATES.includes(candidate)) {
    return null;
  }
  return candidate;
};

const resolveTrialVoiceUrl = (requestedUrl) => {
  const candidate = (
    requestedUrl ||
    process.env.TWILIO_TRIAL_VOICE_URL ||
    DEFAULT_TRIAL_VOICE_URL
  ).trim();

  if (!PREDEFINED_TRIAL_VOICE_URLS.includes(candidate)) {
    return null;
  }
  return candidate;
};

const logNotificationEvent = (level, payload) => {
  const logPayload = {
    timestamp: new Date().toISOString(),
    ...payload
  };
  const prefix = `[Twilio Notification] [${payload.trigger || 'unknown'}] [${payload.channel || 'unknown'}]`;
  if (level === 'error') {
    console.error(prefix, JSON.stringify(logPayload));
  } else if (level === 'warn') {
    console.warn(prefix, JSON.stringify(logPayload));
  } else {
    console.log(prefix, JSON.stringify(logPayload));
  }
};

const classifyTwilioError = (error, formattedTo) => {
  const httpStatus = error?.status || null;
  const errorCode = (error?.code !== undefined && error?.code !== null && error?.code !== 0)
    ? error.code
    : (httpStatus || 'UNKNOWN');
  const errorMessage = error?.message || 'Unknown Twilio error';

  let hint = '';
  if (errorCode === 20003 || httpStatus === 401) {
    hint = 'Authentication failed or feature unavailable on Trial account. Verify TWILIO_ACCOUNT_SID & TWILIO_AUTH_TOKEN.';
  } else if (errorCode === 21608 || errorCode === 21219 || errorCode === 572002 || errorCode === 573002) {
    hint = `Recipient ${formattedTo} is not verified for this Twilio Trial account. Verify the number in Twilio Console (up to 5 recipients in your signup country).`;
  } else if (errorCode === 572006) {
    hint = 'Invalid SMS template name. Twilio Trial SMS requires one of the predefined templates (e.g., sms_appointment_reminders).';
  } else if (httpStatus === 400 && String(errorMessage).toLowerCase().includes('trial accounts have limited parameter access')) {
    hint = 'Twilio Trial rejected disallowed parameters (e.g., custom twiml on calls.create). Use a predefined Twilio Voice template URL instead.';
  }

  const isNonRetryable =
    NON_RETRYABLE_TWILIO_CODES.has(Number(errorCode)) ||
    httpStatus === 400 ||
    httpStatus === 422;

  return { httpStatus, errorCode, errorMessage, hint, isNonRetryable };
};

// Send SMS using Twilio's officially supported predefined trial templates (no custom body)
const sendSMS = async (to, contextOrOptions = {}, maybeOptions = {}) => {
  const options = typeof contextOrOptions === 'object' && contextOrOptions !== null
    ? contextOrOptions
    : { context: contextOrOptions, ...maybeOptions };

  const trigger = options.trigger || 'sms_reminder';
  const channel = 'sms';
  const formattedTo = formatPhoneNumber(to);
  const fromNumber = formatPhoneNumber(process.env.TWILIO_PHONE_NUMBER);

  if (!twilioClient) {
    logNotificationEvent('warn', {
      trigger,
      channel,
      recipient: formattedTo || String(to || ''),
      errorCode: 'CLIENT_NOT_INITIALIZED',
      errorMessage: 'Twilio client not initialized. Skipping SMS.'
    });
    return { success: false, retryable: true, errorCode: 'CLIENT_NOT_INITIALIZED', errorMessage: 'Twilio client not initialized' };
  }

  if (!formattedTo) {
    logNotificationEvent('warn', {
      trigger,
      channel,
      recipient: String(to || ''),
      errorCode: 'INVALID_RECIPIENT',
      errorMessage: 'Invalid or empty recipient phone number for SMS.'
    });
    return { success: false, retryable: false, errorCode: 'INVALID_RECIPIENT', errorMessage: 'Invalid or empty recipient phone number' };
  }

  if (!fromNumber) {
    logNotificationEvent('error', {
      trigger,
      channel,
      recipient: formattedTo,
      errorCode: 'MISSING_SENDER',
      errorMessage: 'TWILIO_PHONE_NUMBER is missing or invalid.'
    });
    return { success: false, retryable: false, errorCode: 'MISSING_SENDER', errorMessage: 'TWILIO_PHONE_NUMBER is missing or invalid' };
  }

  // Strictly enforce Twilio's predefined trial SMS template identifier (never arbitrary custom body)
  const templateName = resolveTrialSmsTemplate(options.templateName);
  if (!templateName) {
    logNotificationEvent('error', {
      trigger,
      channel,
      recipient: formattedTo,
      errorCode: 'INVALID_PREDEFINED_TEMPLATE',
      errorMessage: `Requested SMS template is not in Twilio predefined trial templates: ${PREDEFINED_TRIAL_SMS_TEMPLATES.join(', ')}`
    });
    return { success: false, retryable: false, errorCode: 'INVALID_PREDEFINED_TEMPLATE', errorMessage: 'Template not in official Twilio predefined SMS template list' };
  }

  const requestPayload = {
    body: templateName,
    from: fromNumber,
    to: formattedTo
  };

  logNotificationEvent('info', {
    trigger,
    channel,
    recipient: formattedTo,
    accountType: twilioAccountType,
    context: options.context || undefined,
    twilioRequest: {
      from: requestPayload.from,
      to: requestPayload.to,
      template: requestPayload.body
    }
  });

  try {
    const res = await twilioClient.messages.create(requestPayload);
    if (!res || !res.sid) {
      logNotificationEvent('error', {
        trigger,
        channel,
        recipient: formattedTo,
        errorCode: 'MISSING_TWILIO_SID',
        errorMessage: 'Twilio did not return a valid Message SID.'
      });
      return { success: false, retryable: true, errorCode: 'MISSING_TWILIO_SID', errorMessage: 'Twilio did not return a valid Message SID' };
    }

    logNotificationEvent('info', {
      trigger,
      channel,
      recipient: formattedTo,
      sid: res.sid,
      status: res.status || 'accepted'
    });
    return { success: true, sid: res.sid, status: res.status || 'accepted', template: templateName };
  } catch (error) {
    const classified = classifyTwilioError(error, formattedTo);
    logNotificationEvent('error', {
      trigger,
      channel,
      recipient: formattedTo,
      httpStatus: classified.httpStatus,
      errorCode: classified.errorCode,
      errorMessage: classified.errorMessage,
      hint: classified.hint || undefined
    });
    return {
      success: false,
      retryable: !classified.isNonRetryable,
      errorCode: classified.errorCode,
      errorMessage: classified.errorMessage
    };
  }
};

// Make Voice Call compatible with Twilio Trial API parameter restrictions
const makeVoiceCall = async (to, contextOrOptions = {}, maybeOptions = {}) => {
  const options = typeof contextOrOptions === 'object' && contextOrOptions !== null
    ? contextOrOptions
    : { context: contextOrOptions, ...maybeOptions };

  const trigger = options.trigger || 'voice_reminder';
  const channel = 'voice';
  const formattedTo = formatPhoneNumber(to);
  const fromNumber = formatPhoneNumber(process.env.TWILIO_VOICE_NUMBER || process.env.TWILIO_PHONE_NUMBER);

  if (!twilioClient) {
    logNotificationEvent('warn', {
      trigger,
      channel,
      recipient: formattedTo || String(to || ''),
      errorCode: 'CLIENT_NOT_INITIALIZED',
      errorMessage: 'Twilio client not initialized. Skipping Voice Call.'
    });
    return { success: false, retryable: true, errorCode: 'CLIENT_NOT_INITIALIZED', errorMessage: 'Twilio client not initialized' };
  }

  if (!formattedTo) {
    logNotificationEvent('warn', {
      trigger,
      channel,
      recipient: String(to || ''),
      errorCode: 'INVALID_RECIPIENT',
      errorMessage: 'Invalid or empty recipient phone number for Voice Call.'
    });
    return { success: false, retryable: false, errorCode: 'INVALID_RECIPIENT', errorMessage: 'Invalid or empty recipient phone number' };
  }

  if (!fromNumber) {
    logNotificationEvent('error', {
      trigger,
      channel,
      recipient: formattedTo,
      errorCode: 'MISSING_SENDER',
      errorMessage: 'TWILIO_VOICE_NUMBER / TWILIO_PHONE_NUMBER is missing or invalid.'
    });
    return { success: false, retryable: false, errorCode: 'MISSING_SENDER', errorMessage: 'Voice sender number is missing or invalid' };
  }

  // On Twilio Trial accounts, calls.create() rejects inline `twiml` with HTTP 400
  // ("Invalid or disallowed parameters provided - trial accounts have limited parameter access").
  // Trial calls must use a Twilio-hosted Voice Template webhook URL.
  const voiceUrl = resolveTrialVoiceUrl(options.voiceUrl);
  if (!voiceUrl) {
    logNotificationEvent('error', {
      trigger,
      channel,
      recipient: formattedTo,
      errorCode: 'INVALID_TRIAL_VOICE_URL',
      errorMessage: `TWILIO_TRIAL_VOICE_URL must be one of: ${PREDEFINED_TRIAL_VOICE_URLS.join(', ')}`
    });
    return { success: false, retryable: false, errorCode: 'INVALID_TRIAL_VOICE_URL', errorMessage: 'Voice URL not in predefined trial list' };
  }

  const requestPayload = {
    url: voiceUrl,
    from: fromNumber,
    to: formattedTo
  };

  logNotificationEvent('info', {
    trigger,
    channel,
    recipient: formattedTo,
    accountType: twilioAccountType,
    context: options.context || undefined,
    twilioRequest: {
      from: requestPayload.from,
      to: requestPayload.to,
      url: requestPayload.url
    }
  });

  try {
    const res = await twilioClient.calls.create(requestPayload);
    if (!res || !res.sid) {
      logNotificationEvent('error', {
        trigger,
        channel,
        recipient: formattedTo,
        errorCode: 'MISSING_TWILIO_SID',
        errorMessage: 'Twilio did not return a valid Call SID.'
      });
      return { success: false, retryable: true, errorCode: 'MISSING_TWILIO_SID', errorMessage: 'Twilio did not return a valid Call SID' };
    }

    logNotificationEvent('info', {
      trigger,
      channel,
      recipient: formattedTo,
      sid: res.sid,
      status: res.status || 'queued'
    });
    return { success: true, sid: res.sid, status: res.status || 'queued', url: voiceUrl };
  } catch (error) {
    const classified = classifyTwilioError(error, formattedTo);
    logNotificationEvent('error', {
      trigger,
      channel,
      recipient: formattedTo,
      httpStatus: classified.httpStatus,
      errorCode: classified.errorCode,
      errorMessage: classified.errorMessage,
      hint: classified.hint || undefined
    });
    return {
      success: false,
      retryable: !classified.isNonRetryable,
      errorCode: classified.errorCode,
      errorMessage: classified.errorMessage
    };
  }
};

// Separate WhatsApp sender enforcing WhatsApp Trial compatibility (ContentSid, not SMS templates or custom body)
const sendWhatsAppMessage = async (to, options = {}) => {
  const trigger = options.trigger || 'whatsapp_notification';
  const channel = 'whatsapp';
  const formattedTo = formatWhatsAppAddress(to);
  const rawFrom = (process.env.TWILIO_WHATSAPP_NUMBER || '').trim();
  const formattedFrom = formatWhatsAppAddress(rawFrom);
  const smsPhone = formatPhoneNumber(process.env.TWILIO_PHONE_NUMBER);

  const client = options.client || twilioClient;
  if (!client) {
    logNotificationEvent('warn', {
      trigger,
      channel,
      recipient: formattedTo || String(to || ''),
      errorCode: 'CLIENT_NOT_INITIALIZED',
      errorMessage: 'Twilio client not initialized. Skipping WhatsApp.'
    });
    return { success: false, retryable: true, errorCode: 'CLIENT_NOT_INITIALIZED', errorMessage: 'Twilio client not initialized' };
  }

  if (!formattedTo) {
    logNotificationEvent('warn', {
      trigger,
      channel,
      recipient: String(to || ''),
      errorCode: 'INVALID_RECIPIENT',
      errorMessage: 'Invalid or empty WhatsApp recipient phone number.'
    });
    return { success: false, retryable: false, errorCode: 'INVALID_RECIPIENT', errorMessage: 'Invalid or empty WhatsApp recipient number' };
  }

  if (!formattedFrom) {
    logNotificationEvent('error', {
      trigger,
      channel,
      recipient: formattedTo,
      errorCode: 'MISSING_WHATSAPP_SENDER',
      errorMessage: 'TWILIO_WHATSAPP_NUMBER is missing or invalid.'
    });
    return { success: false, retryable: false, errorCode: 'MISSING_WHATSAPP_SENDER', errorMessage: 'TWILIO_WHATSAPP_NUMBER is missing or invalid' };
  }

  // Warn if TWILIO_WHATSAPP_NUMBER matches the SMS/Voice number instead of a WhatsApp Sandbox/Trial sender
  if (smsPhone && formatPhoneNumber(rawFrom) === smsPhone && process.env.TWILIO_WHATSAPP_SENDER_VERIFIED !== 'true') {
    logNotificationEvent('warn', {
      trigger,
      channel,
      recipient: formattedTo,
      errorCode: 'WHATSAPP_SENDER_NOT_CONFIGURED',
      errorMessage: 'TWILIO_WHATSAPP_NUMBER matches your SMS/Voice trial number and is likely not a WhatsApp-enabled sandbox/trial sender (check Twilio Console > Try out WhatsApp).'
    });
  }

  // Twilio WhatsApp Trial requires ContentSid (HX...) from Console Try out WhatsApp; custom bodies & SMS templates are rejected.
  const contentSid = (options.contentSid || process.env.TWILIO_WHATSAPP_CONTENT_SID || '').trim();
  if (!/^HX[a-f0-9]{32}$/i.test(contentSid)) {
    logNotificationEvent('error', {
      trigger,
      channel,
      recipient: formattedTo,
      errorCode: 'WHATSAPP_TRIAL_CONTENT_SID_REQUIRED',
      errorMessage: 'WhatsApp Trial requires a valid Twilio pre-approved ContentSid (HX...) in TWILIO_WHATSAPP_CONTENT_SID. Custom message bodies and SMS templates are not supported on WhatsApp Trial.'
    });
    return {
      success: false,
      retryable: false,
      errorCode: 'WHATSAPP_TRIAL_CONTENT_SID_REQUIRED',
      errorMessage: 'TWILIO_WHATSAPP_CONTENT_SID (HX...) is required for WhatsApp Trial'
    };
  }

  const requestPayload = {
    contentSid,
    from: formattedFrom,
    to: formattedTo
  };

  if (options.contentVariables) {
    requestPayload.contentVariables = typeof options.contentVariables === 'string'
      ? options.contentVariables
      : JSON.stringify(options.contentVariables);
  } else if (process.env.TWILIO_WHATSAPP_CONTENT_VARIABLES) {
    requestPayload.contentVariables = process.env.TWILIO_WHATSAPP_CONTENT_VARIABLES.trim();
  }

  logNotificationEvent('info', {
    trigger,
    channel,
    recipient: formattedTo,
    accountType: twilioAccountType,
    context: options.context || undefined,
    twilioRequest: {
      from: requestPayload.from,
      to: requestPayload.to,
      contentSid: requestPayload.contentSid,
      hasContentVariables: Boolean(requestPayload.contentVariables)
    }
  });

  try {
    const res = await client.messages.create(requestPayload);
    if (!res || !res.sid) {
      logNotificationEvent('error', {
        trigger,
        channel,
        recipient: formattedTo,
        errorCode: 'MISSING_TWILIO_SID',
        errorMessage: 'Twilio did not return a valid WhatsApp Message SID.'
      });
      return { success: false, retryable: true, errorCode: 'MISSING_TWILIO_SID', errorMessage: 'Twilio did not return a valid WhatsApp Message SID' };
    }

    logNotificationEvent('info', {
      trigger,
      channel,
      recipient: formattedTo,
      sid: res.sid,
      status: res.status || 'accepted'
    });
    return { success: true, sid: res.sid, status: res.status || 'accepted', contentSid };
  } catch (error) {
    const classified = classifyTwilioError(error, formattedTo);
    logNotificationEvent('error', {
      trigger,
      channel,
      recipient: formattedTo,
      httpStatus: classified.httpStatus,
      errorCode: classified.errorCode,
      errorMessage: classified.errorMessage,
      hint: classified.hint || undefined
    });
    return {
      success: false,
      retryable: !classified.isNonRetryable,
      errorCode: classified.errorCode,
      errorMessage: classified.errorMessage
    };
  }
};

const sendDietPlanReminders = async (now) => {
  if (!twilioClient) return;

  const currentHours = now.getHours().toString().padStart(2, '0');
  const currentMinutes = now.getMinutes().toString().padStart(2, '0');
  const currentTimeStr = `${currentHours}:${currentMinutes}`;
  const todayStr = now.toISOString().split('T')[0];

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  // 1. Breakfast and Lunch (Sent the day before at 7:00 PM)
  if (currentTimeStr === '19:00') {
    console.log(`[Scheduler] Checking for breakfast and lunch diet plan reminders to send for tomorrow (${tomorrowStr})...`);
    try {
      const plans = await DietPlan.find({ whatsappNumber: { $ne: '' } });
      for (const plan of plans) {
        if (plan.lastSentDates && plan.lastSentDates.breakfast_lunch === tomorrowStr) {
          continue;
        }

        const bResult = await sendWhatsAppMessage(plan.whatsappNumber, {
          trigger: 'diet_whatsapp_breakfast',
          context: `Breakfast prep reminder for ${tomorrowStr}`
        });
        if (!bResult.success) {
          continue;
        }

        const lResult = await sendWhatsAppMessage(plan.whatsappNumber, {
          trigger: 'diet_whatsapp_lunch',
          context: `Lunch prep reminder for ${tomorrowStr}`
        });
        if (!lResult.success) {
          continue;
        }

        // Only persist sent date when Twilio accepts both requests
        if (!plan.lastSentDates) plan.lastSentDates = {};
        plan.lastSentDates.breakfast_lunch = tomorrowStr;
        await plan.save();
      }
    } catch (err) {
      console.error('[Scheduler] Error in breakfast/lunch sending:', err);
    }
  }

  // 2. Snacks and Dinner (Sent the same day at 10:00 AM)
  if (currentTimeStr === '10:00') {
    console.log(`[Scheduler] Checking for snacks and dinner diet plan reminders to send for today (${todayStr})...`);
    try {
      const plans = await DietPlan.find({ whatsappNumber: { $ne: '' } });
      for (const plan of plans) {
        if (plan.lastSentDates && plan.lastSentDates.snacks_dinner === todayStr) {
          continue;
        }

        const sResult = await sendWhatsAppMessage(plan.whatsappNumber, {
          trigger: 'diet_whatsapp_snacks',
          context: `Snacks reminder for ${todayStr}`
        });
        if (!sResult.success) {
          continue;
        }

        const dResult = await sendWhatsAppMessage(plan.whatsappNumber, {
          trigger: 'diet_whatsapp_dinner',
          context: `Dinner reminder for ${todayStr}`
        });
        if (!dResult.success) {
          continue;
        }

        if (!plan.lastSentDates) plan.lastSentDates = {};
        plan.lastSentDates.snacks_dinner = todayStr;
        await plan.save();
      }
    } catch (err) {
      console.error('[Scheduler] Error in snacks/dinner sending:', err);
    }
  }
};

// Dispatch a notification once with in-flight + permanent-failure deduplication
const dispatchWithDeduplication = async ({ medicineId, dayKey, channel, recipient, senderFn }) => {
  const formattedRecipient = formatPhoneNumber(recipient);
  const lockKey = `${medicineId}:${dayKey}:${channel}`;
  const failureKey = `${lockKey}:${formattedRecipient || 'empty'}`;

  if (inFlightNotifications.has(lockKey)) {
    logNotificationEvent('warn', {
      trigger: `${channel}_dedup_in_flight`,
      channel,
      recipient: formattedRecipient || String(recipient || ''),
      errorCode: 'DUPLICATE_IN_FLIGHT',
      errorMessage: 'Skipping duplicate notification while previous attempt is still in flight.'
    });
    return { success: false, skipped: true };
  }

  if (terminalFailureCache.has(failureKey)) {
    return { success: false, skipped: true };
  }

  inFlightNotifications.add(lockKey);
  try {
    const result = await senderFn();
    if (!result.success && result.retryable === false) {
      terminalFailureCache.add(failureKey);
    }
    return result;
  } finally {
    inFlightNotifications.delete(lockKey);
  }
};

// Process escalation timeline for a single medicine document
// 0m: Alarm -> 2m: SMS -> 7m: Alarm (frontend) -> 9m: Patient Call -> 11m: Emergency Call -> 15m: Missed
const processMedicineEscalation = async (medicine, now = new Date()) => {
  const currentHours = now.getHours().toString().padStart(2, '0');
  const currentMinutes = now.getMinutes().toString().padStart(2, '0');
  const currentTimeStr = `${currentHours}:${currentMinutes}`;
  const todayStr = now.toDateString();

  let todayHistory = medicine.history.find(h =>
    new Date(h.date).toDateString() === todayStr
  );

  console.log(
    'Medicine:',
    medicine.name,
    '| Medicine Time:',
    medicine.time,
    '| Current Time:',
    currentTimeStr,
    '| History Exists:',
    !!todayHistory
  );

  // 0 MINUTES -> Alarm + IoT activation
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

    const device = await Device.findOne({
      userId: medicine.userId,
      reminderMode: 'iot',
      status: 'online'
    });

    if (device) {
      device.reminderActive = true;
      device.medicineName = medicine.name;
      device.reminderTime = now;
      await device.save();
      console.log('IoT Reminder Activated for:', device.deviceId);
    }
  }

  if (!todayHistory) return false;
  if (todayHistory.status === 'taken') return false;

  if (todayHistory.alarmTime && todayHistory.status !== 'taken') {
    const alarmTime = new Date(todayHistory.alarmTime);
    const diffMinutes = Math.floor((now - alarmTime) / (1000 * 60));
    const medicineId = String(medicine._id || medicine.name);

    // 2 MINUTES -> SMS only if first buzzer ignored
    if (
      diffMinutes >= 2 &&
      !todayHistory.smsSent &&
      !todayHistory.firstBuzzerDismissed &&
      todayHistory.status !== 'taken'
    ) {
      const smsRes = await dispatchWithDeduplication({
        medicineId,
        dayKey: todayStr,
        channel: 'sms',
        recipient: medicine.phone,
        senderFn: () => sendSMS(medicine.phone, {
          trigger: '2m_sms_escalation',
          context: `Medicine: ${medicine.name} (${diffMinutes}m elapsed)`
        })
      });

      if (smsRes.success) {
        todayHistory.smsSent = true;
      }
    }

    // 9 MINUTES -> Patient call if still not taken
    if (
      diffMinutes >= 9 &&
      !todayHistory.callSent &&
      todayHistory.status !== 'taken'
    ) {
      const callRes = await dispatchWithDeduplication({
        medicineId,
        dayKey: todayStr,
        channel: 'voice_patient',
        recipient: medicine.phone,
        senderFn: () => makeVoiceCall(medicine.phone, {
          trigger: '9m_patient_voice',
          context: `Medicine: ${medicine.name} (${diffMinutes}m elapsed)`
        })
      });

      if (callRes.success) {
        todayHistory.callSent = true;
      }
    }

    // 11 MINUTES -> Emergency contact call
    if (
      diffMinutes >= 11 &&
      !todayHistory.emergencyCallSent &&
      todayHistory.status !== 'taken'
    ) {
      const emergRes = await dispatchWithDeduplication({
        medicineId,
        dayKey: todayStr,
        channel: 'voice_emergency',
        recipient: medicine.emergencyPhone,
        senderFn: () => makeVoiceCall(medicine.emergencyPhone, {
          trigger: '11m_emergency_voice',
          context: `Emergency alert for medicine: ${medicine.name} (${diffMinutes}m elapsed)`
        })
      });

      if (emergRes.success) {
        todayHistory.emergencyCallSent = true;
      }
    }

    // 15 MINUTES -> Mark missed
    if (
      diffMinutes >= 15 &&
      todayHistory.status !== 'taken'
    ) {
      todayHistory.status = 'missed';
    }
  }

  trimOldHistory(medicine);
  medicine.history.forEach(h => {
    if (h.status === 'upcoming') {
      h.status = 'pending';
    }
  });
  await medicine.save();
  return true;
};

const runSchedulerTick = async (now = new Date()) => {
  if (isSchedulerTickRunning) {
    console.warn('[Scheduler] Previous tick still running; skipping overlapping tick.');
    return;
  }

  isSchedulerTickRunning = true;
  try {
    console.log('Scheduler Running:', now);
    await sendDietPlanReminders(now);

    try {
      const twoMinsAgo = new Date(Date.now() - 2 * 60 * 1000);
      await Device.updateMany(
        { status: 'online', lastSeen: { $lt: twoMinsAgo } },
        { $set: { status: 'offline' } }
      );
    } catch (devErr) {
      console.error('[Scheduler] Error updating device statuses:', devErr);
    }

    const activeMedicines = await Medicine.find({ status: 'active' });
    console.log('Medicines Found:', activeMedicines.length);

    for (const medicine of activeMedicines) {
      await processMedicineEscalation(medicine, now);
    }
  } catch (error) {
    console.error('Scheduler error:', error);
  } finally {
    isSchedulerTickRunning = false;
  }
};

const startScheduler = () => {
  initTwilio();

  // Run every minute
  cron.schedule('* * * * *', async () => {
    await runSchedulerTick(new Date());
  });

  console.log('Scheduler started.');
};

module.exports = {
  startScheduler,
  initTwilio,
  sendSMS,
  makeVoiceCall,
  sendWhatsAppMessage,
  sendDietPlanReminders,
  processMedicineEscalation,
  runSchedulerTick,
  formatPhoneNumber,
  formatWhatsAppAddress,
  resolveTrialSmsTemplate,
  resolveTrialVoiceUrl,
  PREDEFINED_TRIAL_SMS_TEMPLATES,
  PREDEFINED_TRIAL_VOICE_URLS,
  setTwilioClientForTesting,
  clearNotificationGuardsForTesting
};
