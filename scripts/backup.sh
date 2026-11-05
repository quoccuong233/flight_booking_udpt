#!/bin/sh
# Dumps every database, from the replica when it is up to spare the primary.
# Run manually: docker compose exec backup sh /scripts/backup.sh
set -eu

KEEP=7
BACKUP_DIR=${BACKUP_DIR:-/backups}
DATABASES="auth flight search booking payment notification"

if pg_isready -q -h postgres-replica -U postgres -t 5; then
  host=postgres-replica
elif pg_isready -q -h postgres-main -U postgres -t 5; then
  host=postgres-main
  echo "replica unavailable, dumping from postgres-main"
else
  echo "backup failed: neither postgres-replica nor postgres-main is reachable" >&2
  exit 1
fi

# Dump into a hidden folder and rename it only once every database succeeded,
# so a failed run never leaves a partial backup for restore or rotation to pick up.
stamp=$(date +%Y%m%d-%H%M%S)
tmp="$BACKUP_DIR/.$stamp.partial"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp"

for db in $DATABASES; do
  pg_dump -h "$host" -U postgres -Fc -f "$tmp/$db.dump" "$db"
done
mv "$tmp" "$BACKUP_DIR/$stamp"

# The glob skips hidden folders, so only complete backups count towards KEEP.
ls -1d "$BACKUP_DIR"/*/ | sort -r | tail -n +$((KEEP + 1)) | xargs -r rm -rf
echo "backup finished: $BACKUP_DIR/$stamp (from $host)"
