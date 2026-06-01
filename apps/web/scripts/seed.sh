#!/usr/bin/env bash
# Seed the backend with sample transactions so GET /transactions returns data.
# Usage: ./scripts/seed.sh [COUNT]   (default 40)
# Requires the backend running on :3000 (and its postgres + redis up).
set -euo pipefail

API="${API:-http://localhost:3000}"
COUNT="${1:-40}"
COUNTRIES=(US GB DE FR BR JP NG IN)
CURRENCIES=(USD EUR GBP JPY)

echo "Seeding $COUNT transactions -> $API/score"
for i in $(seq 1 "$COUNT"); do
  txid=$(uuidgen | tr 'A-Z' 'a-z')
  country=${COUNTRIES[$((RANDOM % ${#COUNTRIES[@]}))]}
  currency=${CURRENCIES[$((RANDOM % ${#CURRENCIES[@]}))]}
  amount=$(( (RANDOM % 200000) ))            # cents-ish magnitude
  amount="$((amount / 100)).$(printf '%02d' $((amount % 100)))"
  created=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

  curl -s -o /dev/null -w "%{http_code} " -X POST "$API/score" \
    -H 'Content-Type: application/json' \
    -d "{
      \"transactionId\": \"$txid\",
      \"cardToken\": \"card_$((RANDOM % 50))\",
      \"customerId\": \"cust_$((RANDOM % 80))\",
      \"amount\": $amount,
      \"currency\": \"$currency\",
      \"ip\": \"$((RANDOM % 255)).0.0.$((RANDOM % 255))\",
      \"country\": \"$country\",
      \"deviceFingerprint\": \"fp_$((RANDOM % 60))\",
      \"createdAt\": \"$created\"
    }"
done
echo ""
echo "Done. Open the frontend; it will list these via GET /transactions."
