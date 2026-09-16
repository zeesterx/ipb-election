#!/usr/bin/env bash
set -Eeuo pipefail

release_id="${1:-}"
archive_path="${2:-}"
app_root="/opt/ipb-election"
service_name="ipb-election"
health_url="http://127.0.0.1:3000/api/health"
releases_dir="${app_root}/releases"
release_dir="${releases_dir}/${release_id}"
current_link="${app_root}/current"
environment_file="${app_root}/shared/backend.env"

if [[ ! "${release_id}" =~ ^[a-f0-9]{40}-[0-9]+$ ]]; then
  echo "Invalid release identifier." >&2
  exit 1
fi

expected_archive="/tmp/ipb-election-${release_id}.tar.gz"
if [[ "${archive_path}" != "${expected_archive}" ]]; then
  echo "Invalid release archive path." >&2
  exit 1
fi

if [[ ! -f "${archive_path}" ]]; then
  echo "Release archive was not uploaded." >&2
  exit 1
fi

if [[ ! -r "${environment_file}" ]]; then
  echo "Backend environment file is missing or unreadable: ${environment_file}" >&2
  exit 1
fi

cleanup() {
  rm -f -- "${archive_path}"
}
trap cleanup EXIT

mkdir -p -- "${releases_dir}"
if [[ -e "${release_dir}" ]]; then
  echo "Release already exists: ${release_dir}" >&2
  exit 1
fi
mkdir -- "${release_dir}"
tar --no-same-owner -xzf "${archive_path}" -C "${release_dir}"

cd "${release_dir}"
npm ci --omit=dev

cd "${release_dir}/backend"
node --env-file="${environment_file}" dist/migrate.js

previous_release=""
if [[ -L "${current_link}" ]]; then
  previous_release="$(readlink -f "${current_link}")"
fi

ln -sfnT "${release_dir}" "${current_link}"

rollback() {
  if [[ -n "${previous_release}" && -d "${previous_release}" ]]; then
    echo "Health check failed; restoring the previous release." >&2
    ln -sfnT "${previous_release}" "${current_link}"
    sudo systemctl restart "${service_name}"
  else
    echo "Health check failed on the first release; removing the active link." >&2
    rm -f -- "${current_link}"
  fi
}

if ! sudo systemctl restart "${service_name}"; then
  rollback
  exit 1
fi

healthy=false
for _ in {1..20}; do
  if curl --fail --silent --show-error --max-time 5 "${health_url}" >/dev/null; then
    healthy=true
    break
  fi
  sleep 2
done

if [[ "${healthy}" != "true" ]]; then
  rollback
  exit 1
fi

echo "Release ${release_id} is active and healthy."
