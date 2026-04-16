# SATYAM AI

Modern SaaS admin dashboard built with Next.js 14, Tailwind CSS, and MongoDB-ready backend wiring.

## Features

- Login and signup pages
- Responsive dashboard shell with sidebar navigation
- Dark and light mode
- Pages: Dashboard, Leads, Inbox, Followups, Templates, Settings
- Extra pages: Analytics and Automation Settings
- Dummy data widgets for quick iteration
- API route wired for MongoDB fallback to dummy data

## Tech Stack

- Next.js 14 (App Router)
- Tailwind CSS
- MongoDB Node driver
- Deploy ready for Vercel

## Run Locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

Create `.env.local` from `.env.example`:

```bash
cp .env.example .env.local
```

Set:

- `MONGODB_URI` - MongoDB connection string
- `MONGODB_DB` - Database name

If `MONGODB_URI` is missing, app works in dummy-data mode.

## API

- `GET /api/leads` returns MongoDB records when configured, otherwise dummy leads.

## Deploy to Vercel

1. Push this project to GitHub.
2. Import it in Vercel.
3. Add `MONGODB_URI` and `MONGODB_DB` in Vercel project environment variables.
4. Deploy.
