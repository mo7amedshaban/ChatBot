// Minimal Express proxy that forwards chat messages to OpenAI Chat Completions
// Usage: set OPENAI_API_KEY in env or in a .env file and run `node server.js`

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load dotenv from current directory (server/) first
dotenv.config();

// If OPENAI_API_KEY is still missing, try loading workspace root .env (../.env)
if (!process.env.OPENAI_API_KEY) {
  try {
    const rootEnvPath = path.resolve(__dirname, '..', '.env');
    if (fs.existsSync(rootEnvPath)) {
      const envContent = fs.readFileSync(rootEnvPath, { encoding: 'utf8' });
      // dotenv.parse will ignore malformed/comment lines and only return KEY=VALUE pairs
      const parsed = dotenv.parse(envContent);
      Object.keys(parsed).forEach((k) => {
        if (!(k in process.env)) process.env[k] = parsed[k];
      });
    }
  } catch (e) {
    // don't crash on errors reading .env
    console.error('Error reading root .env:', e && e.message);
  }
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('../site'));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.warn('Warning: OPENAI_API_KEY is not set. The proxy will return an error until you set it.');
}

// Enforce fixed model on the server side per user's request
const FIXED_MODEL = 'gpt-4o-mini';

app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).send('messages array required');
    if (!OPENAI_API_KEY) return res.status(500).send('Server missing OPENAI_API_KEY');

    // Always use the fixed model regardless of client input
    const model = FIXED_MODEL;
    console.log('Using model:', model);

    // Forward to OpenAI
    const payload = {
      model,
      messages
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).send(text);
    }

    const data = await response.json();

    // Normalize a small shape to the frontend
    const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return res.json({ reply, raw: data, choices: data.choices });

  } catch (err) {
    console.error('Proxy error', err);
    res.status(500).send('Proxy error');
  }
});

// Streaming endpoint: forwards OpenAI "stream: true" response to the client as text/event-stream
app.post('/api/chat/stream', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).send('messages array required');
    if (!OPENAI_API_KEY) return res.status(500).send('Server missing OPENAI_API_KEY');

    const model = FIXED_MODEL;
    console.log('Streaming using model:', model);

    const payload = {
      model,
      messages,
      stream: true
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).send(text);
    }

    // Set streaming headers for the client
    res.setHeader('Content-Type', 'text/event-stream;charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders && res.flushHeaders();

    // Pipe OpenAI response chunks to the client as they arrive
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        // Write raw chunk to client so frontend can parse data: lines
        res.write(chunk);
      }
    } catch (streamErr) {
      console.error('Error while reading OpenAI stream:', streamErr);
    } finally {
      try { res.end(); } catch (e) { /* ignore */ }
    }

  } catch (err) {
    console.error('Streaming proxy error', err);
    try { res.status(500).send('Streaming proxy error'); } catch (e) { /* ignore */ }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
