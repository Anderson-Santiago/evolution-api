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
    export DB_HOST DB_PORT

    # Write wait script to temp file (avoids bash quoting issues with node -e)
    cat > /tmp/wait-for-db.js <<'JSEOF'
var net = require("net");
var host = process.env.DB_HOST;
var port = parseInt(process.env.DB_PORT) || 5432;
var s = net.createConnection({host: host, port: port});
s.on("connect", function() { s.end(); process.exit(0); });
s.on("error", function() { process.exit(1); });
setTimeout(function() { process.exit(1); }, 2000);
JSEOF

    MAX_RETRIES=30
    RETRY_COUNT=0
    echo "Waiting for database at $DB_HOST:$DB_PORT..."
    while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
        if node /tmp/wait-for-db.js; then
            echo "Database is ready!"
            break
        fi
        RETRY_COUNT=$((RETRY_COUNT + 1))
        echo "Database not ready yet (attempt $RETRY_COUNT/$MAX_RETRIES)..."
        sleep 2
    done
    rm -f /tmp/wait-for-db.js
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
