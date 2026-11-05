#!/bin/sh
# Runs once on the primary's first start: creates the replication role and slot.
set -e

psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<SQL
CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD '${REPLICATOR_PASSWORD}';
SELECT pg_create_physical_replication_slot('replica1');
SQL

echo "host replication replicator all scram-sha-256" >> "$PGDATA/pg_hba.conf"
