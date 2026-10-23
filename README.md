# OWNERS TALENT

> Internal AI-assisted, stage-gated hiring platform for Red Star Technologies HR.

[![Node.js](https://img.shields.io/badge/Node.js-20.x-green.svg)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18-blue.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5-purple.svg)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38bdf8.svg)](https://tailwindcss.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose-brightgreen.svg)](https://mongoosejs.com/)

---

## 📖 Complete Developer Handover Documentation

For full architectural diagrams, database schema definitions, RBAC matrices, background daemon details, and production deployment checklists, please read:

👉 **[HANDOVER.md](./HANDOVER.md)**

---

## ⚡ Quick Start (Local Development)

### 1. Prerequisites
- **Node.js**: `v20.x` or higher
- **MongoDB**: Local MongoDB server or MongoDB Atlas cluster

### 2. Install Dependencies
```bash
# Install root orchestration tools
npm install

# Install backend dependencies
cd server && npm install && cd ..

# Install frontend dependencies
cd client && npm install && cd ..
```

### 3. Configure Environment
Copy `.env.staging.example` to `.env` in the repository root:
```bash
cp .env.staging.example .env
```
Ensure your MongoDB connection string and `JWT_SECRET` are configured.

### 4. Seed Database
```bash
npm run seed
```
This creates the default `owner` account, demo accounts, default pipeline templates, and scoring configuration.

### 5. Start Development Servers
```bash
npm run dev
```
- **Web Application:** `http://localhost:5173`
- **Backend API:** `http://localhost:5000/api`

---

## 📁 Repository Structure

```
├── client/          # Vite + React 18 SPA (Tailwind CSS, Radix UI, TanStack Query)
├── server/          # Express.js REST API & Background Workers (MongoDB, Claude AI, Google Meet)
├── HANDOVER.md      # Master System Architecture & Developer Handover Guide
├── package.json     # Monorepo scripts (concurrent dev runner)
└── .env             # Environment variables (root-level)
```

For questions regarding system architecture, consult **[HANDOVER.md](./HANDOVER.md)**.
