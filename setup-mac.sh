#!/bin/bash

echo "🚀 Welcome to the UniBus Mac Setup Script!"
echo "This script will initialize your databases, install dependencies, and seed the data."
echo "---------------------------------------------------------------------------------"

# Check for Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker Desktop for Mac and try again."
    exit 1
fi

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node (v18+) and try again."
    exit 1
fi

# 1. Setup Backend Environment Variables
echo "📝 Setting up backend environment variables..."
if [ ! -f "backend/.env" ]; then
    cp backend/.env.example backend/.env
    echo "✅ Created backend/.env from .env.example"
else
    echo "⏭️  backend/.env already exists, skipping."
fi

# 2. Start Databases
echo "🐳 Starting PostgreSQL and Redis containers..."
docker compose up -d

echo "⏳ Waiting for PostgreSQL to be ready (5 seconds)..."
sleep 5

# 3. Install Dependencies
echo "📦 Installing backend dependencies..."
cd backend
npm install

echo "📦 Installing frontend dependencies..."
cd ../frontend
npm install
cd ..

# 4. Run Prisma Migrations and Seed
echo "🗄️  Running Prisma migrations and seeding database..."
cd backend
npx prisma generate
npx prisma db push --accept-data-loss
node prisma/seed.js
cd ..

echo "---------------------------------------------------------------------------------"
echo "🎉 Setup complete!"
echo ""
echo "To start the application, open two new terminal tabs:"
echo "Terminal 1 (Backend):  cd backend && npm run dev"
echo "Terminal 2 (Frontend): cd frontend && npm run dev"
echo ""
echo "Admin Login: admin@unibus.local / admin123"
echo "---------------------------------------------------------------------------------"
