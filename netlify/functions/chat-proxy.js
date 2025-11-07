// Netlify Serverless Function that forwards chat messages to the OpenAI API.
// This code is secured by using the OPENAI_API_KEY set in Netlify's Environment Variables.

// Netlify Functions use Node.js, so we don't need Express, cors, or dotenv.
// We only need standard Node modules or fetch.

// The model enforced on the server side
const FIXED_MODEL = 'gpt-4o-mini';
const OPENAI_API_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

/**
 * Main handler for the Netlify Function.
 * It detects if the request is for the standard /api/chat or the streaming /api/chat/stream
 */
exports.handler = async (event, context) => {
    // 1. Check HTTP Method and API Key availability
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
        console.error("OPENAI_API_KEY is not set in Netlify Environment Variables.");
        return { statusCode: 500, body: 'Server missing OPENAI_API_KEY configuration.' };
    }

    // Determine the API path requested by the client (e.g., /api/chat or /api/chat/stream)
    const path = event.path;
    const isStreaming = path.includes('/stream');

    try {
        const { messages } = JSON.parse(event.body);

        if (!messages || !Array.isArray(messages)) {
            return { statusCode: 400, body: 'messages array required' };
        }

        const payload = {
            model: FIXED_MODEL,
            messages,
            stream: isStreaming // Set stream: true only for streaming endpoint
        };

        const response = await fetch(OPENAI_API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify(payload)
        });

        // Handle errors from OpenAI
        if (!response.ok) {
            const text = await response.text();
            return {
                statusCode: response.status,
                body: text,
            };
        }

        // --- Handle Standard POST Request (Non-Streaming) ---
        if (!isStreaming) {
            const data = await response.json();
            // Normalize response shape to what the frontend expects
            const reply = data.choices?.[0]?.message?.content;

            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reply, raw: data, choices: data.choices }),
            };
        }

        // --- Handle Streaming Request (Requires Special Handling) ---

        // Netlify Functions handle streaming differently than Express. 
        // We read the stream and return it as text/plain. The frontend must then handle the SSE format.

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let streamBody = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            streamBody += decoder.decode(value);
        }

        return {
            statusCode: 200,
            // We use text/plain or application/json here, as Netlify Functions API 
            // doesn't natively support setting the full SSE headers. 
            // The frontend should be updated to expect the raw text stream.
            headers: {
                'Content-Type': 'text/plain;charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
            },
            body: streamBody,
        };

    } catch (err) {
        console.error('Netlify Function Proxy error:', err);
        return { statusCode: 500, body: `Proxy error: ${err.message}` };
    }
};