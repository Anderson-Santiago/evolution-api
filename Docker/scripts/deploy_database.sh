#!/bin/bash

source ./Docker/scripts/env_functions.sh

if [ "$DOCKER_ENV" != "true" ]; then
    export_env_vars
fi

if [[ "$DATABASE_PROVIDER" == "postgresql" || "$DATABASE_PROVIDER" == "mysql" || "$DATABASE_PROVIDER" == "psql_bouncer" ]]; then
    export DATABASE_URL
    echo "Deploying migrations for $DATABASE_PROVIDER"
    echo "Database URL: $DATABASE_URL"

    # Wait for database to be ready before running migrations
    DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:/]*\).*|\1|p')
    DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
    DB_PORT="${DB_PORT:-5432}"
    MAX_RETRIES=30
    RETRY_COUNT=0
    echo "Waiting for database at $DB_HOST:$DB_PORT..."
    while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
        if node -e "const s=require('net').createConnection({host:'$DB_HOST',port:$DB_PORT});s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),2000)" 2>/dev/null; then
            echo "Database is ready!"
            break
        fi
        RETRY_COUNT=$((RETRY_COUNT + 1))
        echo "Database not ready yet (attempt $RETRY_COUNT/$MAX_RETRIES)..."
        sleep 2
    done
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        echo "Error: Database at $DB_HOST:$DB_PORT not reachable after $MAX_RETRIES attempts"
        exit 1
    fi

    # rm -rf ./prisma/migrations
    # cp -r ./prisma/$DATABASE_PROVIDER-migrations ./prisma/migrations
    npm run db:deploy
    if [ $? -ne 0 ]; then
        echo "Migration failed"
        exit 1
    else
        echo "Migration succeeded"
    fi
    npm run db:generate
    if [ $? -ne 0 ]; then
        echo "Prisma generate failed"
        exit 1
    else
        echo "Prisma generate succeeded"
    fi
else
    echo "Error: Database provider $DATABASE_PROVIDER invalid."
    exit 1
fi
