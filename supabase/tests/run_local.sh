#!/usr/bin/env bash
# Runs every migration + the demo seed + SQL tests against a THROWAWAY local
# Postgres (never your Supabase project). Requires Postgres 15+ binaries.
#   bash supabase/tests/run_local.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
WORK="${TMPDIR:-/tmp}/nmcn-pgtest-$$"
PORT="${PGTEST_PORT:-54329}"
export PGHOST="$WORK" PGPORT="$PORT" PGUSER=postgres PGDATABASE=nmcn_test

cleanup() { "$PGBIN/pg_ctl" -D "$WORK/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

mkdir -p "$WORK"
"$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -p $PORT -c listen_addresses=''" -l "$WORK/log" start >/dev/null
createdb nmcn_test

export PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
# EXPOSE_NEW_TABLES=off simulates the Supabase setting "Automatically expose new tables" turned off.
"${PSQL[@]}" -v expose="${EXPOSE_NEW_TABLES:-on}" -f supabase/tests/supabase_stub.sql >/dev/null
echo "auto-expose new tables: ${EXPOSE_NEW_TABLES:-on}"
for f in supabase/migrations/*.sql; do
  echo "migrate  $(basename "$f")"
  "${PSQL[@]}" -f "$f" >/dev/null
done
echo "seed     supabase/seed.sql"
"${PSQL[@]}" -f supabase/seed.sql >/dev/null

# Migrations must be re-runnable without errors or data loss.
echo "re-apply migrations (idempotency check)"
for f in supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f" >/dev/null; done

fail=0
for t in supabase/tests/*.test.sql; do
  if "${PSQL[@]}" -f "$t" >"$WORK/out" 2>&1; then
    echo "PASS     $(basename "$t")"
  else
    echo "FAIL     $(basename "$t")"; cat "$WORK/out"; fail=1
  fi
done

# Concurrency: 20 simultaneous AI requests against a 5-credit wallet must
# produce exactly 5 successes and a balance of 0 (no overspend, no negatives).
RACE=00000000-0000-0000-0000-00000000cccc
"${PSQL[@]}" -c "insert into auth.users(id, email) values ('$RACE', 'race@example.test');
  update public.app_settings set value = value || '{\"per_user_per_minute\": 1000}' where key = 'ai.config';
  select public._wallet_lock('$RACE');
  update public.credit_wallets set balance = 5 where user_id = '$RACE';" >/dev/null
for i in $(seq 1 20); do
  psql -X -tA -c "select public.ai_reserve('$RACE', 'summarize', 'race-key-$(printf %04d "$i")', '{}')->>'ok'" >"$WORK/race.$i" 2>&1 &
done
wait
wins=$(cat "$WORK"/race.* | grep -c '^true$' || true)
bal=$(psql -X -tA -c "select balance from public.credit_wallets where user_id = '$RACE'")
if [ "$wins" = "5" ] && [ "$bal" = "0" ]; then
  echo "PASS     concurrent credit reservations (5 of 20 succeeded, balance 0)"
else
  echo "FAIL     concurrent credit reservations (wins=$wins balance=$bal)"; fail=1
fi
exit $fail
