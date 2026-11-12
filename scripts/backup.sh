#!/bin/sh
# Dumps every database, each from its instance's replica when it is up to spare the primary.
# Run manually: docker compose exec backup sh /scripts/backup.sh
set -eu

KEEP=7
BACKUP_DIR=${BACKUP_DIR:-/backups}

# Dump into a hidden folder and rename it only once every database succeeded,
# so a failed run never leaves a partial backup for restore or rotation to pick up.
stamp=$(date +%Y%m%d-%H%M%S)
tmp="$BACKUP_DIR/.$stamp.partial"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp"

# The last line lists the host each instance was dumped from; scripts/failback.ps1 reads it.
sources=""

# dump_instance <name> <replica> <primary> <database>...
dump_instance() {
  name=$1 replica=$2 primary=$3
  shift 3
  if pg_isready -q -h "$replica" -U postgres -t 5; then
    host=$replica
  elif pg_isready -q -h "$primary" -U postgres -t 5; then
    host=$primary
    echo "$replica unavailable, dumping $name from $primary"
  else
    echo "backup failed: neither $replica nor $primary is reachable" >&2
    exit 1
  fi
  for db in "$@"; do
    pg_dump -h "$host" -U postgres -Fc -f "$tmp/$db.dump" "$db"
  done
  sources="$sources $name=$host"
}

dump_instance main postgres-replica postgres-main auth flight search payment notification
dump_instance booking postgres-booking-replica postgres-booking booking

mv "$tmp" "$BACKUP_DIR/$stamp"

# The glob skips hidden folders, so only complete backups count towards KEEP.
ls -1d "$BACKUP_DIR"/*/ | sort -r | tail -n +$((KEEP + 1)) | xargs -r rm -rf
echo "backup finished: $BACKUP_DIR/$stamp (from$sources)"
