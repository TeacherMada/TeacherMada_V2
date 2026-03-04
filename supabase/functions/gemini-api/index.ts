// Follow this pattern to deploy your Edge Function
/* 
1. Create a file: supabase/functions/gemini-api/index.ts
2. Deploy with: supabase functions deploy gemini-api --no-verify-jwt
3. Set secrets: supabase secrets set GEMINI_API_KEY=your_key_here
*/

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { GoogleGenAI } from "https://esm.sh/@google/genai@0.1.1"

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
    
    const ai = new GoogleGenAI({ apiKey: selectedKey })

    // --- ACTIONS ---

    if (action === 'generate') {
      const response = await ai.models.generateContent({
        model: model || 'gemini-2.5-flash',
        contents,
        config
      })
      return new Response(JSON.stringify({ text: response.text }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'generate_stream') {
        const responseStream = await ai.models.generateContentStream({
            model: model || 'gemini-2.5-flash',
            contents,
            config
        });

        const stream = new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder();
                try {
                    for await (const chunk of responseStream) {
                        if (chunk.text) {
                            controller.enqueue(encoder.encode(chunk.text));
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

        const response = await ai.models.generateContent({
            model: model || 'gemini-2.5-flash',
            contents,
            config: {
                ...config,
                responseMimeType: 'application/json',
                responseSchema: schema
            }
        })
        
        return new Response(JSON.stringify({ json: JSON.parse(response.text || '{}') }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    }

    if (action === 'generate_speech') {
        const response = await ai.models.generateContent({
            model: model || 'gemini-2.5-flash-preview-tts',
            contents: [{ parts: [{ text: text }] }],
            config: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: voiceName || 'Kore' }
                    }
                }
            }
        });
        
        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        
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
