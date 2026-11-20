# SoundWave AI integration

This project adds a dedicated `/chat.html` page and a secure server-side OpenAI endpoint at `POST /api/chat`.

## What changed

- `public/chat.html` — dedicated responsive SoundWave AI chat page, using the existing dark theme and green accent.
- `public/index.html` — adds a SoundWave AI link to the existing navigation.
- `netlify/server/index.ts` — adds `POST /api/chat` to the existing Hono API server. It uses OpenAI's Responses API and reads the secret key only on the server.

The existing music player, discovery, uploads, library, and favorites code has been preserved.

## Configure OpenAI on Netlify

1. Create an API key in the OpenAI Platform: https://platform.openai.com/api-keys
2. In Netlify, open the SoundWave site and go to its environment variables.
3. Add `OPENAI_API_KEY` with your secret key as its value.
4. Optionally add `OPENAI_MODEL` with a model available to your OpenAI API project. If omitted, the function uses `gpt-5.5`.
5. Trigger a new deploy after changing environment variables.

Never put the API key in `public/`, frontend JavaScript, or a committed `.env` file.

## Test locally

Use the same Netlify development workflow as the existing project:

```bash
npm install
npx netlify dev
```

Set `OPENAI_API_KEY` in your local shell before starting Netlify Dev. For PowerShell:

```powershell
$env:OPENAI_API_KEY="your-key-here"
npx netlify dev
```

Then open the local site and visit `/chat.html`.

## Deployment notes

The current `netlify.toml` publishes the `public` directory. It was intentionally left unchanged. The existing Netlify server integration in `netlify/server/index.ts` already owns `/api/*`, so the chat endpoint was added there rather than creating a second competing API function.

For a public production app, add durable per-user rate limiting and authentication/abuse controls before promoting the chatbot widely. The message-count and message-size checks in this starter are input validation, not a substitute for durable rate limiting.

## API

`POST /api/chat`

Request:

```json
{
  "messages": [
    { "role": "user", "content": "Recommend music for studying." }
  ]
}
```

Response:

```json
{ "reply": "..." }
```
