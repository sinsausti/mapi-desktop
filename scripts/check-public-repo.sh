#!/usr/bin/env bash
set -euo pipefail

root_dir=$(cd "$(dirname "$0")/.." && pwd)
cd "$root_dir"

failed=0

while IFS= read -r -d '' file_item; do
  case "$file_item" in
    */.DS_Store|.DS_Store|*.db|*.db-*|*.sqlite|*.sqlite-*|*.sqlite3|*.sqlite3-*|*.dump|*.backup|*.dmg|*.pkg|*.p12|*.mobileprovision|*.ofx|*.qfx|*.qif|*.xls|*.xlsx|*.pdf)
      echo "Sensitive or generated file must not be published: $file_item"
      failed=1
      ;;
    */.env|*/.env.*)
      if [[ "$file_item" != "./.env.example" ]]; then
        echo "Local environment file must not be published: $file_item"
        failed=1
      fi
      ;;
  esac
done < <(find . -type f \
  -not -path './.git' \
  -not -path './.git/*' \
  -not -path '*/node_modules/*' \
  -not -path '*/dist/*' \
  -not -path '*/target/*' \
  -print0)

if rg -n --hidden \
  --glob '!**/.git' \
  --glob '!.git/**' \
  --glob '!**/node_modules/**' \
  --glob '!**/dist/**' \
  --glob '!**/target/**' \
  --glob '!scripts/check-public-repo.sh' \
  --glob '!LICENSE' \
  '(/Users/[^/]+/|[A-Za-z0-9._%+-]+@[A-Za-z][A-Za-z0-9.-]*\.[A-Za-z]{2,}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{30,})' .; then
  echo "Possible local path, email address, private key, or token found."
  failed=1
fi

if [[ $failed -ne 0 ]]; then
  exit 1
fi

echo "Public repository check passed. Manual review is still required."
