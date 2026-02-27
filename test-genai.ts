import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function test() {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: "Hello"
  });
  console.log("JSON.stringify:", JSON.stringify(response));
  console.log("response.text:", response.text);
}

test();
