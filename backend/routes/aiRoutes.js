const express = require('express');
const router = express.Router();
const { GoogleGenAI } = require('@google/genai');
const fetch = require('node-fetch');
const twilio = require('twilio');
const DietPlan = require('../models/DietPlan');

router.post('/generate-diet', async (req, res) => {
  try {
    const { reportText, base64Image, mimeType, whatsappNumber } = req.body;

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in backend/.env' });
    }

    // Initialize Gemini AI client
    let aiClient;
    try {
      aiClient = new GoogleGenAI({ 
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: { fetch: fetch }
      });
    } catch (e) {
      console.error("Failed to initialize GoogleGenAI:", e);
      return res.status(500).json({ error: 'Failed to initialize AI client.' });
    }

    const prompt = `You are a highly advanced clinical nutritionist AI, trained in medical diet planning, disease-based nutrition, and patient-specific dietary optimization.

Your task is to:
1. Analyze the uploaded patient medical report.
2. Identify health conditions accurately.
3. Generate a personalized, medically safe, structured daily diet plan.
4. Prepare the output in a format suitable for storage, scheduling, and WhatsApp notifications.

STRICT INSTRUCTIONS:
- Do NOT give generic diet plans.
- Do NOT assume missing medical values.
- Do NOT provide unsafe or extreme diet suggestions.
- Always follow medically accepted dietary guidelines.
- Keep output structured and machine-readable.
- Ensure diet is realistic and regionally adaptable.

PATIENT MEDICAL REPORT:
${reportText ? reportText : "(No text provided. See attached image.)"}
${whatsappNumber ? "\nWhatsApp Number provided for reminders: " + whatsappNumber : ""}

-------------------------------------

OUTPUT REQUIREMENTS:

1. PATIENT SUMMARY:
- Detected conditions (Diabetes, BP, Cholesterol, Thyroid, etc.)
- Key observations from report
- Risk level (Low / Moderate / High)

-------------------------------------

2. DAILY DIET PLAN:

Early Morning Recovery (Pre-Breakfast Prep/Recovery):
- Specific healing or prep drinks/food items (e.g. fresh buttermilk, warm lemon water, ginger tea, herbal infusion, copper-charged water, etc. depending on patient's specific health condition) that help them recover fast and make them healthier.
- Portion sizes
- Calories

Morning (Breakfast):
- Food items
- Portion sizes
- Calories

Afternoon (Lunch):
- Food items
- Portion sizes
- Calories

Evening Snacks:
- Food items
- Portion sizes
- Calories

Night (Dinner):
- Food items
- Portion sizes
- Calories

-------------------------------------

3. WHATSAPP REMINDER MESSAGES (VERY IMPORTANT):

Generate 4 short WhatsApp-ready messages tailored for the patient. Keep the tone friendly and direct:

Breakfast Reminder (sent the previous night at 7:00 PM to allow prep):
- Encourage prepping tomorrow's breakfast and tomorrow's Early Morning recovery items.
- Mention the early morning prep item (e.g., buttermilk) and breakfast food summary.

Lunch Reminder (sent the previous night at 7:00 PM to allow prep):
- Mention tomorrow's lunch food items so the patient can prepare/carry it.

Snacks Reminder (sent same day at 10:00 AM):
- Mention today's evening snack food summary.

Dinner Reminder (sent same day at 10:00 AM):
- Mention today's dinner food summary.

-------------------------------------

4. FOOD IMAGE GENERATION INSTRUCTIONS (VERY IMPORTANT):

- For each meal (Breakfast, Lunch, Snacks, Dinner), provide an EXACT food image description.
- The description must be detailed enough to generate a high-quality visual representation of the food on a plate or bowl, suitable for an image generator (no text or overlays, just the food).
- Do NOT provide URLs.
- Do NOT provide placeholders.

Example:
"images": {
  "breakfast": "a bowl of oats with sliced banana and nuts, healthy breakfast, natural lighting",
  "lunch": "brown rice with grilled chicken breast and steamed broccoli on plate",
  "snacks": "a cup of green tea alongside a small bowl of raw almonds on a wooden tray",
  "dinner": "2 whole wheat chapati with a bowl of lentil dal and vegetable curry on a plate"
}

-------------------------------------

5. RESTRICTIONS:
- Foods to avoid
- Foods to limit

-------------------------------------

6. HYDRATION:
- Daily water intake
- Special instructions

-------------------------------------

7. ADDITIONAL MEDICAL NOTES:
- Warnings
- Lifestyle tips

-------------------------------------

8. TOTAL DAILY CALORIES

-------------------------------------

FINAL OUTPUT FORMAT:
Return STRICT JSON in this structure:

{
  "summary": {
    "detectedConditions": [],
    "keyObservations": [],
    "riskLevel": ""
  },
  "dietPlan": {
    "earlyMorning": {
      "foodItems": [],
      "portionSizes": [],
      "calories": 0
    },
    "morning": {
      "foodItems": [],
      "portionSizes": [],
      "calories": 0
    },
    "afternoon": {
      "foodItems": [],
      "portionSizes": [],
      "calories": 0
    },
    "snacks": {
      "foodItems": [],
      "portionSizes": [],
      "calories": 0
    },
    "night": {
      "foodItems": [],
      "portionSizes": [],
      "calories": 0
    }
  },
  "reminders": {
    "breakfast": "",
    "lunch": "",
    "snacks": "",
    "dinner": ""
  },
  "images": {
    "breakfast": "",
    "lunch": "",
    "snacks": "",
    "dinner": ""
  },
  "restrictions": [],
  "hydration": "",
  "notes": "",
  "totalCalories": 0
}

Do NOT add any explanation outside JSON.`;

    const contentsArray = [];
    contentsArray.push({ text: prompt });

    if (base64Image && mimeType) {
      contentsArray.push({
        inlineData: {
          data: base64Image,
          mimeType: mimeType
        }
      });
    }

    try {
      let response;
      let lastError;
    const modelsToTry = ['gemini-3.5-flash', 'gemini-2.5-flash'];
    const maxRetries = 3;
    const initialDelay = 1000;

    for (const model of modelsToTry) {
      if (response) break;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`Calling Gemini API using model: ${model} (Attempt ${attempt}/${maxRetries})...`);
          response = await aiClient.models.generateContent({
            model: model,
            contents: contentsArray,
            config: {
              responseMimeType: "application/json",
              temperature: 0.2
            }
          });
          break; // Successfully got response, break out of attempt loop
        } catch (err) {
          lastError = err;
          console.error(`Attempt ${attempt} with model ${model} failed:`, err.message || err);
          
          // Determine if we should retry
          const isRetryable = err.status === 429 || err.status === 503 ||
                              (err.message && (err.message.includes('503') || err.message.includes('429') || err.message.includes('temporary') || err.message.includes('demand')));
          
          if (isRetryable && attempt < maxRetries) {
            const delay = initialDelay * Math.pow(2, attempt);
            console.log(`Temporary API issue. Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            // Break to switch to the fallback model or throw
            break;
          }
        }
      }
    }

    if (!response) {
      throw lastError || new Error("All Gemini models and retry attempts failed.");
    }
      
      const responseText = response.text;
      
      // Extract valid JSON substring by counting braces to strip trailing garbage
      const extractValidJson = (str) => {
        const startIdx = str.indexOf('{');
        if (startIdx === -1) return str;
        
        let braceCount = 0;
        let inString = false;
        let escape = false;
        
        for (let i = startIdx; i < str.length; i++) {
          const char = str[i];
          
          if (escape) {
            escape = false;
            continue;
          }
          
          if (char === '\\') {
            escape = true;
            continue;
          }
          
          if (char === '"') {
            inString = !inString;
            continue;
          }
          
          if (!inString) {
            if (char === '{') {
              braceCount++;
            } else if (char === '}') {
              braceCount--;
              if (braceCount === 0) {
                return str.substring(startIdx, i + 1);
              }
            }
          }
        }
        return str;
      };

      const cleanedText = extractValidJson(responseText);
      
      // Attempt to parse JSON response
      let dietPlanData;
      try {
        dietPlanData = JSON.parse(cleanedText);
      } catch (parseErr) {
        console.error("Failed to parse AI JSON response:", responseText);
        return res.status(500).json({ error: 'AI returned invalid JSON format', details: parseErr.message });
      }

      // Save/Update DietPlan in database
      const { userId } = req.body;
      if (userId) {
        try {
          await DietPlan.findOneAndUpdate(
            { userId: userId },
            {
              userId,
              whatsappNumber,
              summary: dietPlanData.summary,
              dietPlan: dietPlanData.dietPlan,
              reminders: dietPlanData.reminders,
              images: dietPlanData.images,
              restrictions: dietPlanData.restrictions,
              hydration: dietPlanData.hydration,
              notes: dietPlanData.notes,
              totalCalories: dietPlanData.totalCalories
            },
            { upsert: true, new: true }
          );
          console.log(`Diet plan successfully saved/updated for userId: ${userId}`);
        } catch (dbErr) {
          console.error("Failed to save diet plan to MongoDB:", dbErr);
        }
      }

      res.status(200).json(dietPlanData);

      // Optional: Dispatch initial Twilio WhatsApp confirmation
      if (whatsappNumber && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_NUMBER) {
        try {
          const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
          
          let formattedNumber = whatsappNumber;
          if (!formattedNumber.startsWith('whatsapp:')) {
            formattedNumber = 'whatsapp:' + formattedNumber;
          }

          const conditions = dietPlanData.summary?.detectedConditions?.join(', ') || 'None';
          const msg = `Hello! Your MedSync Pro AI Diet Plan has been generated. Conditions analyzed: ${conditions}. We will send you reminders here!`;
          
          await twilioClient.messages.create({
            body: msg,
            from: process.env.TWILIO_WHATSAPP_NUMBER,
            to: formattedNumber
          });
          console.log(`Initial WhatsApp confirmation sent to ${formattedNumber}`);
        } catch (twilioErr) {
          console.error("Failed to send WhatsApp message via Twilio:", twilioErr);
        }
      }

    } catch (apiError) {
      console.error("Gemini API Error:", apiError);
      res.status(500).json({ error: 'Failed to generate diet plan from AI', details: apiError.message, stack: apiError.stack });
    }
  } catch (error) {
    console.error("Server Error in /generate-diet:", error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

module.exports = router;
