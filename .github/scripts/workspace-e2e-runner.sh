#!/usr/bin/env bash
# GitHub Actions runner helpers for workspace-e2e (ubuntu-24.04).
#
# Source for SSH helpers (runs on the runner, orchestrates the Windows VM):
#   source .github/scripts/workspace-e2e-runner.sh
#   run_e2e_step InstallNode
#
# Commands (also run on the runner):
#   bash .github/scripts/workspace-e2e-runner.sh resolve-prerelease
#   bash .github/scripts/workspace-e2e-runner.sh prepare-params
#   bash .github/scripts/workspace-e2e-runner.sh write-secrets <dir>
#   bash .github/scripts/workspace-e2e-runner.sh collect junit|failure
#
# Remote Windows steps live in windows-remote-helpers.ps1 (SCP'd to the MAPT VM).

run_remote() {
  local encoded
  encoded=$(printf '%s' "$1" | iconv -t UTF-16LE | base64 -w 0)
  ssh $SSH_OPTS "$REMOTE_HOST" "powershell -NoProfile -EncodedCommand $encoded"
}

run_remote_retry() {
  local max_attempts="${1:-3}"
  local script delay attempt
  if [[ "$max_attempts" =~ ^[0-9]+$ ]]; then
    shift
  else
    max_attempts=3
  fi
  script="$1"
  for attempt in $(seq 1 "$max_attempts"); do
    echo "Remote attempt ${attempt}/${max_attempts}..."
    if run_remote "$script"; then
      return 0
    fi
    if [ "$attempt" -lt "$max_attempts" ]; then
      delay=$((10 * attempt))
      echo "Attempt ${attempt} failed, retrying in ${delay}s..."
      sleep "$delay"
    fi
  done
  echo "All ${max_attempts} remote attempts failed"
  return 1
}

run_e2e_step() {
  local step="$1"
  case "$step" in
    SetPodmanMachineDefaults|InstallNode|InstallGit|CloneAndInstallDeps|InstallPodman|InitPodman|InstallPrerelease|RunE2ETests) ;;
    *)
      echo "Invalid remote step: $step" >&2
      return 1
      ;;
  esac
  run_remote_retry 3 '. "$env:USERPROFILE\ci-scripts\windows-remote-helpers.ps1"; Invoke-KaidenWorkspaceE2ERemoteStep -Step '"$step"
}

# Playwright runs once — no SSH retry (retries belong to Playwright config only when enabled).
run_e2e_test_step() {
  run_remote '. "$env:USERPROFILE\ci-scripts\windows-remote-helpers.ps1"; Invoke-KaidenWorkspaceE2ERemoteStep -Step RunE2ETests'
}

workspace_e2e_fail() {
  echo "::error::$1" >&2
  exit 1
}

workspace_e2e_resolve_prerelease() {
  : "${PRERELEASE_OWNER:?PRERELEASE_OWNER is required}"
  : "${PRERELEASE_REPO:?PRERELEASE_REPO is required}"
  : "${PRERELEASE_INSTALL_MODE:?PRERELEASE_INSTALL_MODE is required}"
  : "${GH_TOKEN:?GH_TOKEN is required}"

  local tag="${PRERELEASE_TAG:-}"
  local api="https://api.github.com/repos/${PRERELEASE_OWNER}/${PRERELEASE_REPO}"
  local release_json asset_filter asset_label url

  if [ -n "$tag" ]; then
    echo "Resolving release by tag: $tag"
    release_json=$(curl --fail --silent --show-error \
      -H "Accept: application/vnd.github+json" \
      -H "Authorization: Bearer ${GH_TOKEN}" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      "${api}/releases/tags/${tag}")
  else
    echo "Resolving latest published release from ${PRERELEASE_OWNER}/${PRERELEASE_REPO}"
    release_json=$(curl --fail --silent --show-error \
      -H "Accept: application/vnd.github+json" \
      -H "Authorization: Bearer ${GH_TOKEN}" \
      -H "X-GitHub-Api-Version: 2022-11-28" \
      "${api}/releases?per_page=1")
    release_json=$(echo "$release_json" | jq '.[0]')
  fi

  local release_id release_tag is_draft
  release_id=$(echo "$release_json" | jq -r '.id')
  release_tag=$(echo "$release_json" | jq -r '.tag_name')
  is_draft=$(echo "$release_json" | jq -r '.draft')
  echo "Release ID: $release_id (tag=$release_tag, draft=$is_draft)"

  if [ "$PRERELEASE_INSTALL_MODE" = "setup" ]; then
    asset_filter='.[] | select(.name | test("^kaiden-.*-setup-x64\\.exe$")) | .browser_download_url'
    asset_label="setup-x64.exe"
  else
    asset_filter='.[] | select(.name | test("^kaiden-.*-x64\\.exe$")) | select(.name | test("setup") | not) | .browser_download_url'
    asset_label="portable x64.exe"
  fi

  url=$(curl --fail --silent --show-error \
    -H "Accept: application/vnd.github+json" \
    -H "Authorization: Bearer ${GH_TOKEN}" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "${api}/releases/${release_id}/assets" \
    | jq -r "$asset_filter" \
    | head -n 1)

  if [ -z "$url" ] || [ "$url" = "null" ]; then
    workspace_e2e_fail "No Windows ${asset_label} asset on ${release_tag}"
  fi

  echo "Kaiden testing prerelease url: ${url}"
  echo "PRERELEASE_URL=${url}" >> "${GITHUB_ENV:?GITHUB_ENV is required}"
}

workspace_e2e_prepare_params() {
  local params_file="${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}/e2e-params.json"
  local github_owner_re='^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$'
  local allowed_env='{}'
  local nvmrc

  [[ "${FORK:-}" =~ $github_owner_re ]] || workspace_e2e_fail "Invalid fork: ${FORK:-<empty>}"
  [[ "${BRANCH:-}" =~ ^[A-Za-z0-9._/-]+$ ]] || workspace_e2e_fail "Invalid branch: ${BRANCH:-<empty>}"
  [[ "${PRERELEASE_OWNER:-}" =~ $github_owner_re ]] || workspace_e2e_fail "Invalid prerelease owner"
  [[ "${PRERELEASE_REPO:-}" =~ ^[A-Za-z0-9._-]+$ ]] || workspace_e2e_fail "Invalid prerelease repo"

  if [ -z "${PRERELEASE_URL:-}" ]; then
    workspace_e2e_fail "PRERELEASE_URL is required"
  fi
  local expected_prefix="https://github.com/${PRERELEASE_OWNER}/${PRERELEASE_REPO}/releases/download/"
  [[ "$PRERELEASE_URL" == "$expected_prefix"* ]] || workspace_e2e_fail "Prerelease URL does not match ${PRERELEASE_OWNER}/${PRERELEASE_REPO}"
  [[ "$PRERELEASE_URL" =~ \.(exe|msi)([?#].*)?$ ]] || workspace_e2e_fail "Prerelease URL must end with .exe or .msi"

  IFS=',' read -ra env_entries <<< "${ENV_VARS:-}"
  for entry in "${env_entries[@]}"; do
    entry="${entry#"${entry%%[![:space:]]*}"}"
    entry="${entry%"${entry##*[![:space:]]}"}"
    [ -z "$entry" ] && continue
    local key="${entry%%=*}"
    local value="${entry#*=}"
    case "$key" in
      PODMAN_ENABLED|WORKSPACE_TESTS_CI)
        [[ "$value" == "true" || "$value" == "false" ]] || workspace_e2e_fail "${key} must be true or false"
        ;;
      DEBUGGING_PORT)
        [[ "$value" =~ ^[0-9]+$ && "$value" -ge 1024 && "$value" -le 65535 ]] || workspace_e2e_fail "Invalid DEBUGGING_PORT"
        ;;
      CONTAINERS_MACHINE_PROVIDER)
        [[ "$value" == "wsl" || "$value" == "hyperv" ]] || workspace_e2e_fail "Invalid CONTAINERS_MACHINE_PROVIDER"
        ;;
      *) workspace_e2e_fail "Disallowed env_vars key: ${key}" ;;
    esac
    allowed_env=$(jq -c --arg k "$key" --arg v "$value" '. + {($k): $v}' <<< "$allowed_env")
  done

  nvmrc=$(curl -fsSL "https://raw.githubusercontent.com/${FORK}/${TARGET_REPO}/${BRANCH}/.nvmrc" 2>/dev/null || cat "${GITHUB_WORKSPACE}/.nvmrc")
  nvmrc=$(printf '%s' "$nvmrc" | tr -d '\r\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  [[ "$nvmrc" =~ ^v?[0-9]+(\.[0-9]+)*$ ]] || workspace_e2e_fail "Invalid .nvmrc version: ${nvmrc:-<empty>}"

  jq -n \
    --arg fork "$FORK" \
    --arg branch "$BRANCH" \
    --arg repo "${TARGET_REPO:?TARGET_REPO is required}" \
    --arg npmTarget "${NPM_TARGET:?NPM_TARGET is required}" \
    --arg podmanProvider "${PODMAN_PROVIDER:-wsl}" \
    --arg podmanDownloadUrl "${PODMAN_URL:?PODMAN_URL is required}" \
    --arg prereleaseOwner "$PRERELEASE_OWNER" \
    --arg prereleaseRepo "$PRERELEASE_REPO" \
    --arg prereleaseTag "${PRERELEASE_TAG:-}" \
    --arg prereleaseDownloadUrl "$PRERELEASE_URL" \
    --arg prereleaseInstallMode "${PRERELEASE_INSTALL_MODE:-setup}" \
    --arg nvmrcVersion "$nvmrc" \
    --argjson allowedEnv "$allowed_env" \
    '{
      fork: $fork,
      branch: $branch,
      repo: $repo,
      npmTarget: $npmTarget,
      podmanProvider: $podmanProvider,
      podmanDownloadUrl: $podmanDownloadUrl,
      prereleaseOwner: $prereleaseOwner,
      prereleaseRepo: $prereleaseRepo,
      prereleaseTag: $prereleaseTag,
      prereleaseDownloadUrl: $prereleaseDownloadUrl,
      prereleaseInstallMode: $prereleaseInstallMode,
      nvmrcVersion: $nvmrcVersion,
      allowedEnv: $allowedEnv
    }' >"$params_file"

  echo "Remote params written to ${params_file}"
}

workspace_e2e_write_secrets() {
  local workdir="${1:-.}"
  local npm_target="${NPM_TARGET:-test:e2e:workspaces}"
  local install_secrets="${workdir}/install-secrets.txt"
  local test_secrets="${workdir}/secrets.txt"
  local test_keys key val

  mkdir -p "$workdir"
  : >"$install_secrets"
  if [ -n "${PRERELEASE_TOKEN:-}" ]; then
    printf 'PRERELEASE_TOKEN=%s\n' "$PRERELEASE_TOKEN" >>"$install_secrets"
  fi

  case "$npm_target" in
    test:e2e:workspaces:claude) test_keys="ANTHROPIC_API_KEY" ;;
    test:e2e:workspaces:goose) test_keys="OPENAI_API_KEY MISTRAL_API_KEY" ;;
    test:e2e:workspaces:opencode|test:e2e:workspaces:openclaw)
      test_keys="OPENAI_API_KEY GEMINI_API_KEY ANTHROPIC_API_KEY MISTRAL_API_KEY"
      ;;
    *) test_keys="ANTHROPIC_API_KEY OPENAI_API_KEY GEMINI_API_KEY MISTRAL_API_KEY" ;;
  esac

  : >"$test_secrets"
  for key in $test_keys; do
    val="${!key:-}"
    if [ -n "$val" ]; then
      printf '%s=%s\n' "$key" "$val" >>"$test_secrets"
    fi
  done
}

workspace_e2e_scrub_file() {
  local file="$1"
  local var val
  [ -f "$file" ] || return 0
  for var in SCRUB_ANTHROPIC_API_KEY SCRUB_OPENAI_API_KEY SCRUB_GEMINI_API_KEY SCRUB_MISTRAL_API_KEY SCRUB_PRERELEASE_TOKEN; do
    val="${!var:-}"
    [ -n "$val" ] || continue
    VAL="$val" perl -pi -e 's/\Q$ENV{VAL}\E/[REDACTED]/g' "$file"
  done
  perl -pi -e 's/(Bearer\s+\S+|sk-ant-[A-Za-z0-9_-]+|sk-proj-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9]+|gho_[A-Za-z0-9]+)/[REDACTED]/g' "$file"
}

workspace_e2e_collect_junit() {
  local results_dir="${GITHUB_WORKSPACE:?}/results"
  local remote_base="workspace/${TARGET_REPO:?}/tests/playwright"
  local collected=0

  echo "::group::Collect JUnit results via SCP"
  mkdir -p "$results_dir"
  if scp $SSH_OPTS "$REMOTE_HOST:${remote_base}/output/junit-results.xml" "$results_dir/" 2>/dev/null; then
    collected=1
  fi
  if scp $SSH_OPTS "$REMOTE_HOST:${remote_base}/output/*results.xml" "$results_dir/" 2>/dev/null; then
    collected=1
  fi
  if scp $SSH_OPTS "$REMOTE_HOST:${remote_base}/*results.xml" "$results_dir/" 2>/dev/null; then
    collected=1
  fi
  if [ "$collected" -eq 0 ]; then
    echo "No JUnit XML found"
  fi
  echo "::endgroup::"
}

workspace_e2e_verify_junit() {
  local results_dir="${GITHUB_WORKSPACE:?}/results"
  local junit_file summary tests failures errors skipped executed

  if ! compgen -G "${results_dir}/*results.xml" > /dev/null; then
    workspace_e2e_fail "No JUnit test results found — Playwright did not write junit-results.xml"
  fi

  echo "JUnit results found:"
  ls -la "${results_dir}"/*results.xml

  for junit_file in "${results_dir}"/*results.xml; do
    summary=$(python3 -c "
import xml.etree.ElementTree as ET
root = ET.parse('${junit_file}').getroot()
tests = failures = errors = skipped = 0
for suite in root.iter('testsuite'):
    tests += int(suite.get('tests', 0))
    failures += int(suite.get('failures', 0))
    errors += int(suite.get('errors', 0))
    skipped += int(suite.get('skipped', 0))
print(tests, failures, errors, skipped)
")
    read -r tests failures errors skipped <<< "$summary"
    executed=$((tests - skipped))
    echo "${junit_file}: tests=${tests} executed=${executed} skipped=${skipped} failures=${failures} errors=${errors}"
    if [ "$executed" -eq 0 ]; then
      workspace_e2e_fail "All ${tests} tests were skipped — check API keys and PODMAN_ENABLED on the remote host"
    fi
  done
}

workspace_e2e_collect_failure() {
  local results_dir="${GITHUB_WORKSPACE:?}/results"
  local remote_base="workspace/${TARGET_REPO:?}/tests/playwright"
  local remote_output="${remote_base}/output"
  local file

  echo "::group::Collect failure diagnostics via SCP"
  mkdir -p "$results_dir"

  scp $SSH_OPTS -r "$REMOTE_HOST:${remote_output}/test-results" "$results_dir/playwright-test-results" 2>/dev/null \
    || echo "No Playwright test-results found"
  scp $SSH_OPTS -r "$REMOTE_HOST:${remote_output}/html-report" "$results_dir/playwright-html-report" 2>/dev/null \
    || echo "No Playwright html-report found"
  scp $SSH_OPTS -r "$REMOTE_HOST:${remote_output}/screen-recordings" "$results_dir/screen-recordings" 2>/dev/null \
    || echo "No screen recordings found"
  scp $SSH_OPTS "$REMOTE_HOST:${remote_output}/test-results.json" "$results_dir/test-results.json" 2>/dev/null \
    || echo "No test-results.json found"

  find "$results_dir" -type f \( -name 'trace.zip' -o -name '*.webm' \) -delete 2>/dev/null || true

  while IFS= read -r -d '' file; do
    workspace_e2e_scrub_file "$file"
  done < <(find "$results_dir" -type f \( -name '*.json' -o -name '*.log' -o -name '*.xml' -o -name '*.txt' -o -name '*.html' \) -print0 2>/dev/null)

  echo "Collected failure diagnostics:"
  find "$results_dir" -type f | sort || true
  echo "::endgroup::"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  set -euo pipefail
  case "${1:-}" in
    resolve-prerelease) workspace_e2e_resolve_prerelease ;;
    prepare-params) workspace_e2e_prepare_params ;;
    write-secrets) workspace_e2e_write_secrets "${2:-.}" ;;
    verify-junit) workspace_e2e_verify_junit ;;
    collect)
      : "${REMOTE_HOST:?REMOTE_HOST is required}"
      : "${SSH_OPTS:?SSH_OPTS is required}"
      case "${2:-}" in
        junit) workspace_e2e_collect_junit ;;
        failure) workspace_e2e_collect_failure ;;
        *) workspace_e2e_fail "usage: $0 collect junit|failure" ;;
      esac
      ;;
    *)
      echo "usage: $0 resolve-prerelease|prepare-params|write-secrets <dir>|verify-junit|collect junit|failure" >&2
      echo "or: source $0  # SSH helpers for run_e2e_step / run_e2e_test_step" >&2
      exit 1
      ;;
  esac
fi
