const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const scheduler = require('../services/scheduler');
const Device = require('../models/Device');

const originalEnv = { ...process.env };
const originalDeviceFindOne = Device.findOne;

const createMockMedicine = (overrides = {}) => {
  const med = {
    _id: 'med-123',
    userId: 'user-1',
    name: 'Aspirin 75mg',
    time: '09:00',
    phone: '7036356681',
    emergencyPhone: '+919876543210',
    reminderStatus: 'idle',
    history: [],
    saveCalls: 0,
    async save() {
      this.saveCalls += 1;
      return this;
    },
    ...overrides
  };
  return med;
};

describe('Twilio Trial Notification & Escalation Scheduler', () => {
  beforeEach(() => {
    process.env.TWILIO_PHONE_NUMBER = '+17372508034';
    process.env.TWILIO_WHATSAPP_NUMBER = '+14155238886';
    delete process.env.TWILIO_VOICE_NUMBER;
    delete process.env.TWILIO_TRIAL_SMS_TEMPLATE;
    delete process.env.TWILIO_TRIAL_VOICE_URL;
    delete process.env.TWILIO_WHATSAPP_CONTENT_SID;
    delete process.env.TWILIO_WHATSAPP_CONTENT_VARIABLES;
    scheduler.clearNotificationGuardsForTesting();
    Device.findOne = async () => null;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    Device.findOne = originalDeviceFindOne;
    scheduler.setTwilioClientForTesting(null, 'Trial');
    scheduler.clearNotificationGuardsForTesting();
  });

  it('sends SMS using official predefined template identifier (never custom text)', async () => {
    const sentRequests = [];
    scheduler.setTwilioClientForTesting({
      messages: {
        create: async (payload) => {
          sentRequests.push(payload);
          return { sid: 'SM_TEST_123', status: 'queued' };
        }
      },
      calls: { create: async () => ({ sid: 'CA_UNUSED' }) }
    }, 'Trial');

    const result = await scheduler.sendSMS('7036356681', {
      trigger: '2m_sms_escalation',
      context: 'Medicine: Aspirin'
    });

    assert.equal(result.success, true);
    assert.equal(result.sid, 'SM_TEST_123');
    assert.equal(sentRequests.length, 1);
    assert.equal(sentRequests[0].to, '+917036356681');
    assert.equal(sentRequests[0].from, '+17372508034');
    assert.equal(sentRequests[0].body, 'sms_appointment_reminders');
    assert.ok(scheduler.PREDEFINED_TRIAL_SMS_TEMPLATES.includes(sentRequests[0].body));
  });

  it('rejects non-predefined SMS templates without calling Twilio API', async () => {
    let called = false;
    scheduler.setTwilioClientForTesting({
      messages: {
        create: async () => {
          called = true;
          return { sid: 'SM_SHOULD_NOT_HAPPEN' };
        }
      }
    }, 'Trial');

    const result = await scheduler.sendSMS('+917036356681', {
      trigger: 'test',
      templateName: 'Custom message: please take medicine'
    });

    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'INVALID_PREDEFINED_TEMPLATE');
    assert.equal(called, false);
  });

  it('makes trial voice calls using predefined Voice template URL instead of disallowed twiml parameter', async () => {
    const callRequests = [];
    scheduler.setTwilioClientForTesting({
      messages: { create: async () => ({ sid: 'SM_UNUSED' }) },
      calls: {
        create: async (payload) => {
          callRequests.push(payload);
          return { sid: 'CA_TEST_456', status: 'queued' };
        }
      }
    }, 'Trial');

    const result = await scheduler.makeVoiceCall('7036356681', {
      trigger: '9m_patient_voice',
      context: 'Medicine: Aspirin'
    });

    assert.equal(result.success, true);
    assert.equal(result.sid, 'CA_TEST_456');
    assert.equal(callRequests.length, 1);
    assert.equal(callRequests[0].to, '+917036356681');
    assert.equal(callRequests[0].from, '+17372508034');
    assert.equal(callRequests[0].url, 'https://webhooks.twilio.com/v1/Voice/Template/voice_text_to_speech');
    assert.equal(callRequests[0].twiml, undefined);
  });

  it('requires ContentSid for WhatsApp trial and does not reuse SMS templates', async () => {
    let called = false;
    const mockClient = {
      messages: {
        create: async (payload) => {
          called = true;
          return { sid: 'SM_WA_789', status: 'queued', payload };
        }
      }
    };
    scheduler.setTwilioClientForTesting(mockClient, 'Trial');

    // Without TWILIO_WHATSAPP_CONTENT_SID, must fail cleanly without calling Twilio
    const missingSidRes = await scheduler.sendWhatsAppMessage('7036356681', {
      trigger: 'diet_whatsapp_initial'
    });
    assert.equal(missingSidRes.success, false);
    assert.equal(missingSidRes.errorCode, 'WHATSAPP_TRIAL_CONTENT_SID_REQUIRED');
    assert.equal(called, false);

    // With valid ContentSid, sends whatsapp: formatted addresses and contentSid (no SMS template body)
    process.env.TWILIO_WHATSAPP_CONTENT_SID = 'HXb5b62575e6e4ff6129ad7c8efe1f983e';
    const okRes = await scheduler.sendWhatsAppMessage('7036356681', {
      trigger: 'diet_whatsapp_initial'
    });
    assert.equal(okRes.success, true);
    assert.equal(okRes.sid, 'SM_WA_789');
    assert.equal(called, true);
  });

  it('preserves escalation timeline (0m, 2m, 9m, 11m, 15m) and prevents duplicates', async () => {
    const events = [];
    scheduler.setTwilioClientForTesting({
      messages: {
        create: async (payload) => {
          events.push({ channel: 'sms', to: payload.to, body: payload.body });
          return { sid: `SM_${events.length}`, status: 'queued' };
        }
      },
      calls: {
        create: async (payload) => {
          events.push({ channel: 'voice', to: payload.to, url: payload.url });
          return { sid: `CA_${events.length}`, status: 'queued' };
        }
      }
    }, 'Trial');

    const baseTime = new Date(2026, 10, 25, 9, 0, 0, 0);
    const med = createMockMedicine({ time: '09:00' });

    // 0m: Alarm triggered, no SMS/calls yet
    await scheduler.processMedicineEscalation(med, baseTime);
    assert.equal(med.reminderStatus, 'ringing');
    assert.equal(med.history.length, 1);
    assert.equal(events.length, 0);

    // 2m: SMS sent once
    await scheduler.processMedicineEscalation(med, new Date(baseTime.getTime() + 2 * 60 * 1000));
    assert.equal(med.history[0].smsSent, true);
    assert.equal(events.length, 1);
    assert.equal(events[0].channel, 'sms');

    // 3m: Re-running cron must NOT duplicate SMS
    await scheduler.processMedicineEscalation(med, new Date(baseTime.getTime() + 3 * 60 * 1000));
    assert.equal(events.length, 1);

    // 9m: Patient call placed once
    await scheduler.processMedicineEscalation(med, new Date(baseTime.getTime() + 9 * 60 * 1000));
    assert.equal(med.history[0].callSent, true);
    assert.equal(events.length, 2);
    assert.equal(events[1].to, '+917036356681');

    // 11m: Emergency contact call placed once
    await scheduler.processMedicineEscalation(med, new Date(baseTime.getTime() + 11 * 60 * 1000));
    assert.equal(med.history[0].emergencyCallSent, true);
    assert.equal(events.length, 3);
    assert.equal(events[2].to, '+919876543210');

    // 15m: Marked as missed, no further notifications
    await scheduler.processMedicineEscalation(med, new Date(baseTime.getTime() + 15 * 60 * 1000));
    assert.equal(med.history[0].status, 'missed');
    assert.equal(events.length, 3);
  });

  it('does NOT mark smsSent or callSent true when Twilio rejects the request', async () => {
    let attempts = 0;
    scheduler.setTwilioClientForTesting({
      messages: {
        create: async () => {
          attempts += 1;
          const err = new Error('Invalid template name');
          err.code = 572006;
          err.status = 400;
          throw err;
        }
      },
      calls: {
        create: async () => {
          attempts += 1;
          const err = new Error('Invalid or disallowed parameters provided - trial accounts have limited parameter access');
          err.code = 0;
          err.status = 400;
          throw err;
        }
      }
    }, 'Trial');

    const baseTime = new Date(2026, 10, 25, 9, 0, 0, 0);
    const med = createMockMedicine({
      history: [{
        date: baseTime,
        alarmTime: baseTime,
        status: 'pending',
        firstBuzzerDismissed: false,
        smsSent: false,
        callSent: false,
        emergencyCallSent: false
      }]
    });

    // At 11m, all 3 fail -> flags MUST stay false
    await scheduler.processMedicineEscalation(med, new Date(baseTime.getTime() + 11 * 60 * 1000));
    assert.equal(med.history[0].smsSent, false);
    assert.equal(med.history[0].callSent, false);
    assert.equal(med.history[0].emergencyCallSent, false);
    assert.equal(attempts, 3);

    // Next minute tick: terminal non-retryable failures are suppressed from spamming Twilio
    await scheduler.processMedicineEscalation(med, new Date(baseTime.getTime() + 12 * 60 * 1000));
    assert.equal(attempts, 3);
  });
});
