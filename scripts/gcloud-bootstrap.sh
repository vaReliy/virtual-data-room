#!/usr/bin/env bash
#
# One-time Google Cloud bootstrap for the Virtual Data Room (decision #22).
#
# Run this ONCE, in Cloud Shell, where gcloud is already installed and already
# authenticated. It is deliberately never run on a development machine: no cloud
# credential belongs there, and an authenticated gcloud is reachable by every process
# on the box.
#
#   1. Open https://console.cloud.google.com and press the Cloud Shell icon (>_).
#   2. Upload this file, or paste it into `nano gcloud-bootstrap.sh`.
#   3. PROJECT_ID=<your-project> bash gcloud-bootstrap.sh
#
# The script is idempotent: every resource is created only if `describe` fails, so a
# re-run after a partial failure is safe and costs nothing.
#
# What it creates:
#   - the APIs the deploy needs
#   - an Artifact Registry Docker repository for the API image
#   - six Secret Manager secrets, whose values you are prompted for (nothing is echoed,
#     nothing is written to a file, nothing lands in shell history)
#   - a runtime service account for Cloud Run, allowed to read exactly those secrets
#   - a deploying service account for GitHub Actions
#   - a Workload Identity Pool and an OIDC provider that trusts this one repository on
#     this one branch, pinned by NUMERIC id
#
# What it deliberately does NOT create: a service-account key. There is none, anywhere.

set -euo pipefail

# --------------------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------------------

# Your Google Cloud project. The only value with no sensible default.
PROJECT_ID="${PROJECT_ID:?set PROJECT_ID, e.g. PROJECT_ID=my-project bash $0}"

# Frankfurt. This must stay in the same region as the Neon database (aws-eu-central-1):
# every API request makes several database round-trips, and a cross-continent hop turns
# a 2 ms query into a 100 ms one.
REGION="${REGION:-europe-west3}"

# GitHub identity, pinned NUMERICALLY on purpose. A repository *name* is released when
# the repository is deleted and can then be claimed by someone else; this repository is
# public, so a name-based condition would be a standing invitation. Re-read these with
#   gh api repos/vaReliy/virtual-data-room --jq '.id, .owner.id'
GITHUB_REPOSITORY_ID="${GITHUB_REPOSITORY_ID:-1345744292}"
GITHUB_REPOSITORY_OWNER_ID="${GITHUB_REPOSITORY_OWNER_ID:-6352600}"
GITHUB_BRANCH="${GITHUB_BRANCH:-main}"

# Resource names. Change them only if something already occupies the name.
AR_REPOSITORY="${AR_REPOSITORY:-dataroom}"
POOL_ID="${POOL_ID:-github}"
PROVIDER_ID="${PROVIDER_ID:-virtual-data-room}"
RUNTIME_SA_ID="${RUNTIME_SA_ID:-dataroom-api}"
DEPLOYER_SA_ID="${DEPLOYER_SA_ID:-github-deployer}"

# The six values that must not appear in a workflow file, a repository variable or this
# script. Cloud Run reads them from Secret Manager at start-up.
SECRETS=(
  dataroom-database-url
  dataroom-direct-url
  dataroom-google-client-secret
  dataroom-session-secret
  dataroom-storage-access-key-id
  dataroom-storage-secret-access-key
)

RUNTIME_SA="${RUNTIME_SA_ID}@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOYER_SA="${DEPLOYER_SA_ID}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud config set project "${PROJECT_ID}" >/dev/null

# The pool member string needs the project NUMBER, not the id. They are different values
# and substituting one for the other produces a binding that silently never matches.
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
skip() { printf '    exists, skipping: %s\n' "$1"; }

# --------------------------------------------------------------------------------------
# 1. APIs
# --------------------------------------------------------------------------------------

step "Enabling APIs"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  iam.googleapis.com \
  cloudresourcemanager.googleapis.com

# --------------------------------------------------------------------------------------
# 2. Artifact Registry
# --------------------------------------------------------------------------------------

step "Artifact Registry repository ${AR_REPOSITORY} (${REGION})"
if gcloud artifacts repositories describe "${AR_REPOSITORY}" --location="${REGION}" >/dev/null 2>&1; then
  skip "${AR_REPOSITORY}"
else
  gcloud artifacts repositories create "${AR_REPOSITORY}" \
    --repository-format=docker \
    --location="${REGION}" \
    --description="Virtual Data Room API images"
fi

# --------------------------------------------------------------------------------------
# 3. Secrets
# --------------------------------------------------------------------------------------
#
# Prompted for, never passed as an argument: an argument would land in the process list
# and in shell history. `read -rs` echoes nothing.

step "Secret Manager"
for secret in "${SECRETS[@]}"; do
  if ! gcloud secrets describe "${secret}" >/dev/null 2>&1; then
    gcloud secrets create "${secret}" --replication-policy=automatic
  fi

  if gcloud secrets versions list "${secret}" --filter='state:ENABLED' --format='value(name)' | grep -q .; then
    skip "${secret} (already has a version)"
    continue
  fi

  printf '    value for %s (input hidden): ' "${secret}"
  read -rs value
  printf '\n'
  printf '%s' "${value}" | gcloud secrets versions add "${secret}" --data-file=-
  unset value
done

# --------------------------------------------------------------------------------------
# 4. Runtime service account — what Cloud Run runs as
# --------------------------------------------------------------------------------------

step "Runtime service account ${RUNTIME_SA}"
if gcloud iam service-accounts describe "${RUNTIME_SA}" >/dev/null 2>&1; then
  skip "${RUNTIME_SA}"
else
  gcloud iam service-accounts create "${RUNTIME_SA_ID}" \
    --display-name="Virtual Data Room API (Cloud Run runtime)"
fi

# Granted per secret rather than project-wide. This account can read these six values and
# nothing else in the project — including nothing added to Secret Manager later.
for secret in "${SECRETS[@]}"; do
  gcloud secrets add-iam-policy-binding "${secret}" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role=roles/secretmanager.secretAccessor \
    --condition=None >/dev/null
done

# --------------------------------------------------------------------------------------
# 5. Deploying service account — what GitHub Actions acts as
# --------------------------------------------------------------------------------------

step "Deploying service account ${DEPLOYER_SA}"
if gcloud iam service-accounts describe "${DEPLOYER_SA}" >/dev/null 2>&1; then
  skip "${DEPLOYER_SA}"
else
  gcloud iam service-accounts create "${DEPLOYER_SA_ID}" \
    --display-name="GitHub Actions deployer (Workload Identity Federation)"
fi

# Push images. Scoped to the one repository, not to Artifact Registry project-wide.
gcloud artifacts repositories add-iam-policy-binding "${AR_REPOSITORY}" \
  --location="${REGION}" \
  --member="serviceAccount:${DEPLOYER_SA}" \
  --role=roles/artifactregistry.writer >/dev/null

# Create and update the Cloud Run service.
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${DEPLOYER_SA}" \
  --role=roles/run.admin \
  --condition=None >/dev/null

# Deploy a service that RUNS AS the runtime account. Without this the deploy fails with
# a permission error naming the runtime account, which reads like the wrong problem.
gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_SA}" \
  --member="serviceAccount:${DEPLOYER_SA}" \
  --role=roles/iam.serviceAccountUser >/dev/null

# --------------------------------------------------------------------------------------
# 6. Workload Identity Federation
# --------------------------------------------------------------------------------------

step "Workload Identity Pool ${POOL_ID}"
if gcloud iam workload-identity-pools describe "${POOL_ID}" --location=global >/dev/null 2>&1; then
  skip "${POOL_ID}"
else
  gcloud iam workload-identity-pools create "${POOL_ID}" \
    --location=global \
    --display-name="GitHub Actions"
fi

# The condition is the whole security boundary. Every clause matters:
#   repository_id        this repository, by an id that cannot be re-registered
#   repository_owner_id  under this account, likewise
#   ref                  from main only, so a pull request from a fork cannot deploy
# All three claims are strings in GitHub's token, hence the quotes on the numbers.
ATTRIBUTE_CONDITION="assertion.repository_id == '${GITHUB_REPOSITORY_ID}' && assertion.repository_owner_id == '${GITHUB_REPOSITORY_OWNER_ID}' && assertion.ref == 'refs/heads/${GITHUB_BRANCH}'"

# repository_id is mapped as well as asserted: the IAM binding below addresses the
# principal set by that attribute, and an unmapped attribute cannot be addressed.
ATTRIBUTE_MAPPING="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_id=assertion.repository_id,attribute.ref=assertion.ref"

# No trailing slash. GitHub's `iss` claim is exactly this string, and Google compares the
# two literally — some Google documentation shows a trailing slash, which does not match.
ISSUER_URI="https://token.actions.githubusercontent.com"

step "OIDC provider ${PROVIDER_ID}"
if gcloud iam workload-identity-pools providers describe "${PROVIDER_ID}" \
     --location=global --workload-identity-pool="${POOL_ID}" >/dev/null 2>&1; then
  # Updated rather than skipped: the condition is the one thing here worth re-applying,
  # since a repository can be renamed, transferred or recreated.
  gcloud iam workload-identity-pools providers update-oidc "${PROVIDER_ID}" \
    --location=global \
    --workload-identity-pool="${POOL_ID}" \
    --attribute-mapping="${ATTRIBUTE_MAPPING}" \
    --attribute-condition="${ATTRIBUTE_CONDITION}"
else
  gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_ID}" \
    --location=global \
    --workload-identity-pool="${POOL_ID}" \
    --display-name="virtual-data-room" \
    --issuer-uri="${ISSUER_URI}" \
    --attribute-mapping="${ATTRIBUTE_MAPPING}" \
    --attribute-condition="${ATTRIBUTE_CONDITION}"
fi

POOL_RESOURCE="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}"

# Let that one repository impersonate the deploying account. Note the member addresses
# attribute.repository_id — a workflow from any other repository presents a different id
# and matches nothing, even if it somehow passed the provider condition.
gcloud iam service-accounts add-iam-policy-binding "${DEPLOYER_SA}" \
  --member="principalSet://iam.googleapis.com/${POOL_RESOURCE}/attribute.repository_id/${GITHUB_REPOSITORY_ID}" \
  --role=roles/iam.workloadIdentityUser >/dev/null

# --------------------------------------------------------------------------------------
# Done
# --------------------------------------------------------------------------------------

cat <<SUMMARY

$(printf '\033[1mBootstrap complete.\033[0m')

Give these three values to the assistant; they are configuration, not secrets, and they
become GitHub Actions repository variables:

  GCP_PROJECT_ID     ${PROJECT_ID}
  GCP_SERVICE_ACCOUNT ${DEPLOYER_SA}
  GCP_WIF_PROVIDER   ${POOL_RESOURCE}/providers/${PROVIDER_ID}

Nothing above is a credential. The provider only issues short-lived tokens, and only to a
workflow running on refs/heads/${GITHUB_BRANCH} of repository id ${GITHUB_REPOSITORY_ID}.
SUMMARY
