// Follow this pattern to deploy your Edge Function
/* 
1. Create a file: supabase/functions/gemini-api/index.ts
2. Deploy with: supabase functions deploy gemini-api --no-verify-jwt
3. Set secrets: supabase secrets set GEMINI_API_KEY=your_key_here
*/

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { action, model, contents, config, schemaType, text, voiceName } = await req.json()
    
    // Get API Key from Secrets
    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) {
      throw new Error('Missing GEMINI_API_KEY in Edge Function Secrets')
    }

    // Handle Rotation if comma separated
    const keys = apiKey.split(',').map(k => k.trim()).filter(k => k)
    const selectedKey = keys[Math.floor(Math.random() * keys.length)]
    
    const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

    // --- ACTIONS ---

    if (action === 'generate') {
      const targetModel = model || 'gemini-2.5-flash';
      const response = await fetch(`${BASE_URL}/${targetModel}:generateContent?key=${selectedKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: typeof contents === 'string' ? [{ parts: [{ text: contents }] }] : contents,
          generationConfig: config
        })
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Gemini API Error: ${err}`);
      }

      const data = await response.json();
      const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

      return new Response(JSON.stringify({ text: generatedText }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'generate_stream') {
        const targetModel = model || 'gemini-2.5-flash';
        const response = await fetch(`${BASE_URL}/${targetModel}:streamGenerateContent?alt=sse&key=${selectedKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: typeof contents === 'string' ? [{ parts: [{ text: contents }] }] : contents,
                generationConfig: config
            })
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Gemini API Error: ${err}`);
        }

        const reader = response.body?.getReader();
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();

        const stream = new ReadableStream({
            async start(controller) {
                if (!reader) {
                    controller.close();
                    return;
                }

                try {
                    let buffer = "";
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        
                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || ""; // Keep incomplete line

                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                const jsonStr = line.slice(6).trim();
                                if (jsonStr === '[DONE]') continue;
                                try {
                                    const data = JSON.parse(jsonStr);
                                    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                                    if (text) {
                                        controller.enqueue(encoder.encode(text));
                                    }
                                } catch (e) {
                                    // Ignore parse errors
                                }
                            }
                        }
                    }
                    controller.close();
                } catch (e) {
                    controller.error(e);
                }
            }
        });

        return new Response(stream, {
            headers: { ...corsHeaders, 'Content-Type': 'text/event-stream' }
        });
    }

    if (action === 'generate_json') {
        const targetModel = model || 'gemini-2.5-flash';
        let schema = config?.responseSchema;
        
        // Pre-defined schemas for security/convenience
        if (schemaType === 'ARRAY_VOCAB') {
             schema = {
                type: 'ARRAY',
                items: {
                    type: 'OBJECT',
                    properties: {
                        word: { type: 'STRING' },
                        translation: { type: 'STRING' },
                        example: { type: 'STRING' }
                    }
                }
            }
        } else if (schemaType === 'ARRAY_EXERCISE') {
            schema = {
                type: 'ARRAY',
                items: {
                    type: 'OBJECT',
                    properties: {
                        id: { type: 'STRING' },
                        type: { type: 'STRING' },
                        question: { type: 'STRING' },
                        options: { type: 'ARRAY', items: { type: 'STRING' } },
                        correctAnswer: { type: 'STRING' },
                        explanation: { type: 'STRING' }
                    },
                    required: ["type", "question", "correctAnswer", "explanation"]
                }
            }
        } else if (schemaType === 'OBJECT_ROLEPLAY') {
            schema = {
                type: 'OBJECT',
                properties: {
                    aiReply: { type: 'STRING' },
                    correction: { type: 'STRING' },
                    explanation: { type: 'STRING' },
                    score: { type: 'NUMBER' },
                    feedback: { type: 'STRING' }
                },
                required: ["aiReply"]
            }
        }

        const response = await fetch(`${BASE_URL}/${targetModel}:generateContent?key=${selectedKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: typeof contents === 'string' ? [{ parts: [{ text: contents }] }] : contents,
                generationConfig: {
                    ...config,
                    responseMimeType: 'application/json',
                    responseSchema: schema
                }
            })
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Gemini API Error: ${err}`);
        }

        const data = await response.json();
        const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
        
        return new Response(JSON.stringify({ json: JSON.parse(generatedText) }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    }

    if (action === 'generate_speech') {
        // Note: TTS via REST API might differ slightly or require specific endpoint.
        // Using standard generateContent with audio modality if supported by model, 
        // OR using the specific speech endpoint if available.
        // For gemini-2.5-flash-preview-tts, it uses generateContent.
        
        const targetModel = model || 'gemini-2.5-flash-preview-tts';
        
        const response = await fetch(`${BASE_URL}/${targetModel}:generateContent?key=${selectedKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: text }] }],
                generationConfig: {
                    responseModalities: ['AUDIO'],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: voiceName || 'Kore' }
                        }
                    }
                }
            })
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Gemini TTS API Error: ${err}`);
        }

        const data = await response.json();
        const base64Audio = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        
        return new Response(JSON.stringify({ audioBase64: base64Audio }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    }

    throw new Error(`Unknown action: ${action}`)

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
