#!/bin/bash

# Deploy workshop-websocket-server to Railway
# This script uses Railway's GraphQL API to create a project and deploy

RAILWAY_TOKEN="ad092b2c-c0c6-43a8-9db8-4159e0e6fcb3"
REPO_URL="geverist/workshop-websocket-server"

echo "🚂 Deploying to Railway..."

# Step 1: Create Railway project
echo "📦 Creating Railway project..."

PROJECT_RESPONSE=$(curl -s -X POST https://backboard.railway.app/graphql/v2 \
  -H "Authorization: Bearer ${RAILWAY_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mutation { projectCreate(input: { name: \"workshop-websocket-server\" }) { id name environments { edges { node { id name } } } } }"
  }')

PROJECT_ID=$(echo $PROJECT_RESPONSE | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
ENV_ID=$(echo $PROJECT_RESPONSE | grep -o '"id":"[^"]*"' | tail -1 | cut -d'"' -f4)

if [ -z "$PROJECT_ID" ]; then
  echo "❌ Failed to create project"
  echo $PROJECT_RESPONSE
  exit 1
fi

echo "✅ Created project: $PROJECT_ID"
echo "✅ Environment ID: $ENV_ID"

# Step 2: Create service with GitHub repo
echo "📦 Creating service from GitHub repo..."

SERVICE_RESPONSE=$(curl -s -X POST https://backboard.railway.app/graphql/v2 \
  -H "Authorization: Bearer ${RAILWAY_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"query\": \"mutation { serviceCreate(input: { projectId: \\\"${PROJECT_ID}\\\", environmentId: \\\"${ENV_ID}\\\", source: { repo: \\\"${REPO_URL}\\\" } }) { id name } }\"
  }")

SERVICE_ID=$(echo $SERVICE_RESPONSE | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$SERVICE_ID" ]; then
  echo "❌ Failed to create service"
  echo $SERVICE_RESPONSE
  exit 1
fi

echo "✅ Created service: $SERVICE_ID"

# Step 3: Set environment variables (you'll need to add POSTGRES_URL manually in Railway dashboard)
echo ""
echo "✅ Deployment initiated!"
echo ""
echo "⚠️  NEXT STEPS:"
echo "1. Go to https://railway.app/project/${PROJECT_ID}"
echo "2. Add environment variable: POSTGRES_URL=<your-vercel-postgres-url>"
echo "3. Add environment variable: OPENAI_API_KEY=<fallback-key>"
echo "4. Railway will automatically deploy"
echo ""
echo "📝 Save these IDs:"
echo "   Project ID: ${PROJECT_ID}"
echo "   Service ID: ${SERVICE_ID}"
