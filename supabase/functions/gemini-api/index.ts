// Follow this pattern to deploy your Edge Function
/* 
1. Create a file: supabase/functions/gemini-api/index.ts
2. Deploy with: supabase functions deploy gemini-api --no-verify-jwt
3. Set secrets: supabase secrets set GEMINI_API_KEY=your_key_here
*/

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { action, model, contents, config, schemaType, text, voiceName } = await req.json()
    
    // 1. HEALTH CHECK
    if (action === 'health') {
        const apiKey = Deno.env.get('GEMINI_API_KEY');
        return new Response(JSON.stringify({ 
            status: 'ok', 
            hasKey: !!apiKey,
            keyLength: apiKey ? apiKey.length : 0 
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    }

    // 2. GET API KEY
    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) {
      // Return 200 with error field to see it in client
      return new Response(JSON.stringify({ error: 'Missing GEMINI_API_KEY in Edge Function Secrets' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Handle Rotation
    const keys = apiKey.split(',').map(k => k.trim()).filter(k => k)
    const selectedKey = keys[Math.floor(Math.random() * keys.length)]
    
    const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models"

    // --- ACTIONS ---

    if (action === 'generate') {
      const targetModel = model || 'gemini-2.0-flash'; // Fallback to stable model
      
      // Extract systemInstruction from config if present
      const { systemInstruction, ...genConfig } = config || {};

      const body: any = {
          contents: typeof contents === 'string' ? [{ parts: [{ text: contents }] }] : contents,
          generationConfig: genConfig
      };

      if (systemInstruction) {
          body.systemInstruction = { parts: [{ text: systemInstruction }] };
      }

      const response = await fetch(`${BASE_URL}/${targetModel}:generateContent?key=${selectedKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const err = await response.text();
        return new Response(JSON.stringify({ error: `Gemini API Error (${response.status}): ${err}` }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const data = await response.json();
      const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

      return new Response(JSON.stringify({ text: generatedText }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'generate_stream') {
        const targetModel = model || 'gemini-2.0-flash';
        
        // Extract systemInstruction from config if present
        const { systemInstruction, ...genConfig } = config || {};

        const body: any = {
            contents: typeof contents === 'string' ? [{ parts: [{ text: contents }] }] : contents,
            generationConfig: genConfig
        };

        if (systemInstruction) {
            body.systemInstruction = { parts: [{ text: systemInstruction }] };
        }

        const response = await fetch(`${BASE_URL}/${targetModel}:streamGenerateContent?alt=sse&key=${selectedKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const err = await response.text();
            // Cannot return JSON for stream, must throw or return error event
            // We return a JSON error response instead of stream
             return new Response(JSON.stringify({ error: `Gemini Stream API Error (${response.status}): ${err}` }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
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
                                        // Send as SSE data
                                        const sseData = `data: ${JSON.stringify({ text })}\n\n`;
                                        controller.enqueue(encoder.encode(sseData));
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
        const targetModel = model || 'gemini-2.0-flash';
        let schema = config?.responseSchema;
        
        // Pre-defined schemas
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
            };
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
            };
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
            };
        }

        // Extract systemInstruction from config if present
        const { systemInstruction, ...genConfig } = config || {};

        const body: any = {
            contents: typeof contents === 'string' ? [{ parts: [{ text: contents }] }] : contents,
            generationConfig: {
                ...genConfig,
                responseMimeType: 'application/json',
                responseSchema: schema
            }
        };

        if (systemInstruction) {
            body.systemInstruction = { parts: [{ text: systemInstruction }] };
        }

        const response = await fetch(`${BASE_URL}/${targetModel}:generateContent?key=${selectedKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const err = await response.text();
             return new Response(JSON.stringify({ error: `Gemini JSON API Error (${response.status}): ${err}` }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const data = await response.json();
        const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
        
        return new Response(JSON.stringify({ json: JSON.parse(generatedText) }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    }

    if (action === 'generate_speech') {
        const targetModel = model || 'gemini-2.0-flash-exp'; // TTS model
        
        // Extract systemInstruction from config if present (though unlikely for TTS)
        const { systemInstruction, ...genConfig } = config || {};

        const body: any = {
            contents: [{ parts: [{ text: text }] }],
            generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: voiceName || 'Kore' }
                    }
                }
            }
        };

        const response = await fetch(`${BASE_URL}/${targetModel}:generateContent?key=${selectedKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const err = await response.text();
             return new Response(JSON.stringify({ error: `Gemini TTS API Error (${response.status}): ${err}` }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const data = await response.json();
        const base64Audio = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        
        return new Response(JSON.stringify({ audioBase64: base64Audio }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: `Edge Function Crash: ${error.message}` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
