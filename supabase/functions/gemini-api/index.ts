import { GoogleGenAI } from "npm:@google/genai";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

class KeyManager {
  private keys: { key: string; failureCount: number; blockedUntil: number }[] = [];
  private currentIndex = 0;

  constructor(apiKeys: string) {
    if (apiKeys) {
      this.keys = apiKeys.split(',').map(k => ({
        key: k.trim(),
        failureCount: 0,
        blockedUntil: 0
      })).filter(k => k.key.length > 0);
    }
  }

  getNextKey(): string {
    if (this.keys.length === 0) throw new Error('No API keys configured');
    const now = Date.now();
    let attempts = 0;
    while (attempts < this.keys.length) {
      const keyObj = this.keys[this.currentIndex];
      if (keyObj.blockedUntil > 0 && now > keyObj.blockedUntil) {
        keyObj.blockedUntil = 0;
        keyObj.failureCount = 0;
      }
      if (keyObj.blockedUntil === 0) {
        this.currentIndex = (this.currentIndex + 1) % this.keys.length;
        return keyObj.key;
      }
      this.currentIndex = (this.currentIndex + 1) % this.keys.length;
      attempts++;
    }
    throw new Error('All API keys are currently blocked');
  }

  reportFailure(key: string) {
    const keyObj = this.keys.find(k => k.key === key);
    if (!keyObj) return;
    keyObj.failureCount++;
    if (keyObj.failureCount >= 3) {
      keyObj.blockedUntil = Date.now() + 5 * 60 * 1000;
    }
  }

  reportSuccess(key: string) {
    const keyObj = this.keys.find(k => k.key === key);
    if (keyObj && keyObj.failureCount > 0) {
      keyObj.failureCount = Math.max(0, keyObj.failureCount - 1);
    }
  }
}

const keyManager = new KeyManager(Deno.env.get('GOOGLE_API_KEYS') || Deno.env.get('GEMINI_API_KEY') || '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    let action = url.searchParams.get('action');

    if (action === 'live') {
      if (req.headers.get("upgrade") != "websocket") {
        return new Response("Expected websocket", { status: 400 });
      }
      const { socket, response } = Deno.upgradeWebSocket(req);
      
      let geminiWs: any = null;
      let isConnecting = false;
      let apiKey = '';

      socket.onopen = () => {
        try {
          apiKey = keyManager.getNextKey();
        } catch (e) {
          socket.close(1008, 'No available API keys');
          return;
        }
      };

      socket.onmessage = async (e) => {
        const data = e.data;
        
        try {
          const parsed = JSON.parse(data);
          
          if (parsed.type === 'setup') {
            if (isConnecting || geminiWs) return;
            isConnecting = true;
            
            const { model, config } = parsed;
            const client = new GoogleGenAI({ apiKey });
            
            try {
              geminiWs = await client.live.connect({
                model: model || 'gemini-2.5-flash-native-audio-preview-09-2025',
                config,
                callbacks: {
                  onopen: () => {
                    socket.send(JSON.stringify({ type: 'open' }));
                    keyManager.reportSuccess(apiKey);
                  },
                  onmessage: (msg) => {
                    if (socket.readyState === WebSocket.OPEN) {
                      socket.send(JSON.stringify(msg));
                    }
                  },
                  onclose: () => {
                    if (socket.readyState === WebSocket.OPEN) socket.close(1000, 'Gemini closed');
                  },
                  onerror: (err) => {
                    keyManager.reportFailure(apiKey);
                    if (socket.readyState === WebSocket.OPEN) socket.close(1011, 'Gemini error');
                  }
                }
              });
            } catch (err) {
              keyManager.reportFailure(apiKey);
              socket.close(1011, 'Failed to connect to Gemini');
            } finally {
              isConnecting = false;
            }
          } else if (geminiWs) {
            if (parsed.realtimeInput) {
              geminiWs.sendRealtimeInput(parsed.realtimeInput);
            } else if (parsed.toolResponse) {
              geminiWs.sendToolResponse(parsed.toolResponse);
            }
          }
        } catch (err) {
          console.error('Error handling WS message', err);
        }
      };

      socket.onclose = () => {
        if (geminiWs) {
          try { geminiWs.close(); } catch(e) {}
        }
      };

      return response;
    }

    const body = await req.json();
    const { model, contents, config } = body;
    action = action || body.action || 'generate';
    
    const apiKey = keyManager.getNextKey();
    const client = new GoogleGenAI({ apiKey });

    if (action === 'stream') {
      const result = await client.models.generateContentStream({
        model: model || 'gemini-2.5-flash',
        contents,
        config
      });

      keyManager.reportSuccess(apiKey);

      const stream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of result) {
              const text = chunk.text;
              if (text) {
                controller.enqueue(new TextEncoder().encode(text));
              }
            }
            controller.close();
          } catch (err) {
            controller.error(err);
          }
        }
      });

      return new Response(stream, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/plain; charset=utf-8',
          'Transfer-Encoding': 'chunked'
        }
      });
    } else {
      const response = await client.models.generateContent({
        model: model || 'gemini-2.5-flash',
        contents,
        config
      });
      keyManager.reportSuccess(apiKey);
      return new Response(JSON.stringify({
        text: response.text,
        candidates: response.candidates,
        functionCalls: response.functionCalls
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  } catch (error: any) {
    console.error('API Error:', error);
    return new Response(JSON.stringify({ error: error.message, stack: error.stack }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
