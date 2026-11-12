#!/bin/sh
# Restores one database. Stop the services that write to it first.
# Usage: docker compose exec backup sh /scripts/restore.sh <backup-folder> <database>
set -eu

if [ $# -ne 2 ]; then
  echo "usage: restore.sh <backup-folder> <database>" >&2
  exit 1
fi

dump="/backups/$1/$2.dump"
[ -f "$dump" ] || { echo "not found: $dump" >&2; exit 1; }

# Restore into the current primary of the database's instance: the replica after scripts/failover.ps1.
if [ "$2" = booking ]; then
  host=${BOOKING_DB_HOST:-postgres-booking}
else
  host=${POSTGRES_HOST:-postgres-main}
fi
pg_restore -h "$host" -U postgres -d "$2" --clean --if-exists "$dump"
echo "restored $2 into $host from $dump"
