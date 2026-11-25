# PIT WALL // SYNC

## Setup
1. Install Node.js.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Add your single `AI_API_KEY`. Optionally set `AI_BASE_URL` and `AI_MODEL`.
5. Run `npm run dev`.

## Universal AI connection
The app uses one OpenAI-compatible vision API connection. The server reads `AI_API_KEY` and automatically sends timetable images to `${AI_BASE_URL}/chat/completions` using `AI_MODEL`. The defaults target the OpenAI API; compatible gateways/providers can be used by changing the base URL and model. The model must support image input and chat-completions-style requests. For example, an OpenAI-compatible routing service can expose multiple underlying models behind one key. PDF uploads are rendered to a page image in the browser before being sent.

API credentials remain in the server `.env`; never commit that file. The server validates payloads and rate-limits requests.

## Production
Set `AI_API_KEY`, optional `AI_BASE_URL` and `AI_MODEL` as server environment variables, set `NODE_ENV=production`, run `npm run build`, then `npm start`. Deploy to a Node.js host, not static-only hosting.
