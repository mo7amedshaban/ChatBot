# Chatbot Proxy Server

This is a minimal Express proxy that forwards chat requests from the frontend to the OpenAI Chat Completions API.

Prerequisites
- Node.js 18+
- An OpenAI API key

Setup
1. Copy `.env.example` to `.env` and set `OPENAI_API_KEY`.
2. Install dependencies and start the server:

```bash
cd server
npm install
npm start
```

The static frontend is served from `../site` so you can open http://localhost:3000/ to view the chat UI.

