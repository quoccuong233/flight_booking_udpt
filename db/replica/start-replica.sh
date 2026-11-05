#!/bin/sh
# Clones the primary on first start, then runs as a hot standby.
set -e

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  chown -R postgres:postgres "$PGDATA"
  chmod 700 "$PGDATA"

  until su-exec postgres pg_isready -h "$PRIMARY_HOST" -U replicator; do
    sleep 1
  done

  PGPASSWORD="$REPLICATOR_PASSWORD" su-exec postgres pg_basebackup \
    -h "$PRIMARY_HOST" -U replicator -D "$PGDATA" -X stream -S replica1 -R --checkpoint=fast
fi

exec su-exec postgres postgres -c hot_standby=on -c max_connections=200
