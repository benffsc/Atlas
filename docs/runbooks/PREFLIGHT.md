# Preflight Checks

Safety checks to run before commits and deployments.

## Quick Checklist

Before every commit:
- [ ] No secrets in staged files
- [ ] No data exports staged
- [ ] `.gitignore` covers new file types
- [ ] Tests pass (when we have them)

---

## 1. Secret Scan

Search for potential secrets in the codebase:

```bash
# API keys and tokens
rg -n "AIza|pat[A-Za-z0-9]{20,}|sk-[a-zA-Z0-9]{20,}" .

# Database URLs (should only be in .env.example with placeholders)
rg -n "postgres://|postgresql://" . --glob '!.env.example'

# Supabase-specific
rg -n "supabase\.co.*password|eyJ[a-zA-Z0-9]+" .

# Private keys
rg -n "BEGIN PRIVATE|BEGIN RSA|BEGIN EC" .
```

**Expected results:** Only `.env.example` should match, with placeholder values.

---

## 2. Data Export Check

Ensure no data files are staged:

```bash
# Check for common data file extensions
git status | grep -E "\.(csv|xlsx|xls|tsv|json)$"

# Should return empty (no matches)
```

If files appear, they should be:
- Listed in `.gitignore`
- Removed from staging with `git reset <file>`

---

## 3. .gitignore Verification

Confirm data directories are ignored:

```bash
# These should all return "not tracked"
git check-ignore data/
git check-ignore *.csv
git check-ignore *.xlsx
git check-ignore .env
```

---

## 4. Environment File Check

Ensure `.env` is not tracked:

```bash
# Should show .env as ignored
git status --ignored | grep "\.env"

# .env should NOT appear in tracked files
git ls-files | grep "\.env"
# (should return nothing except .env.example)
```

---

## Pre-Commit Hook (Optional)

Add to `.git/hooks/pre-commit`:

```bash
#!/bin/bash
# Prevent committing secrets

# Check for API keys
if git diff --cached | grep -E "AIza|pat[A-Za-z0-9]{20,}|sk-" > /dev/null; then
  echo "ERROR: Potential API key detected in commit"
  exit 1
fi

# Check for data files
if git diff --cached --name-only | grep -E "\.(csv|xlsx|xls)$" > /dev/null; then
  echo "ERROR: Data file detected in commit"
  exit 1
fi

exit 0
```

Make executable: `chmod +x .git/hooks/pre-commit`

---

## When Things Go Wrong

### Accidentally Committed Secrets

1. **Don't push** — If not pushed yet, you can fix locally
2. **Remove from history** — Use `git filter-branch` or BFG Repo-Cleaner
3. **Rotate secrets** — Consider any committed secret as compromised
4. **Notify** — If already pushed to remote, inform team

### Accidentally Committed Data

1. **Remove from staging:** `git reset HEAD <file>`
2. **Add to .gitignore** if pattern is new
3. **If already committed:** `git rm --cached <file>` and commit

---

*Run these checks habitually. Accidents happen; catching them early is key.*
