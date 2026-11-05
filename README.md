# Git, Set, Go!

## Run locally

1. Copy `.env.example` to `.env`.
2. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` using the Upstash instructions below.
3. Optionally set `GITHUB_TOKEN` to a GitHub personal access token to increase GitHub API rate limits.
4. Run `npm install`, then `npm run dev` for the frontend and `npm start` for the API.

## Deploy to Vercel with Upstash Redis

1. Create a Redis database in [Upstash](https://console.upstash.com/). Choose a region near your Vercel deployment.
2. In the database's **REST API** section, copy its REST URL and REST token. Do not expose the token in frontend code or commit it to Git.
3. Import this repository into Vercel. Keep the project root at the repository root; the included `vercel.json` builds the Vite frontend into `dist` and deploys `api/[...route].js` as a Node.js Function.
4. In Vercel, open **Project Settings → Environment Variables** and add:
   - `UPSTASH_REDIS_REST_URL` — the Upstash REST URL.
   - `UPSTASH_REDIS_REST_TOKEN` — the Upstash REST token.
   - `GITHUB_TOKEN` — optional GitHub personal access token for higher API rate limits.
5. Add the Redis variables to each environment you use (Production, Preview, and Development), then redeploy.
6. Open the deployed site, register with a GitHub username, verify a repository, and check the Leaderboard tab. The API and frontend use the same origin; no separate API URL or CORS configuration is needed.

The leaderboard stores participants, repo claims, scores, and registration tokens in Upstash Redis. Use a separate Redis database for development and production if you want to keep their data isolated.
