#!/usr/bin/env bash

set -euo pipefail

PLUGIN_ID="obsidian-docs-publisher"
REPO="xaistrying/obsidian-docs-publisher"
FILES="manifest.json main.js styles.css"

log() { echo "[docs-publisher] $1"; }
fail() { echo "[docs-publisher] ERROR: $1" >&2; exit 1; }

vault=""
version=""
local_mode=0
while [ "$#" -gt 0 ]; do
	case "$1" in
	--version) version="${2:-}"; [ -n "$version" ] || fail "--version needs a value, like v0.2.0"; shift 2 ;;
	--local) local_mode=1; shift ;;
	-h | --help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
	-*) fail "unknown option: $1" ;;
	*) [ -z "$vault" ] || fail "only one vault folder, please"; vault="$1"; shift ;;
	esac
done

# --- where the vault is ---------------------------------------------------------

# The vaults Obsidian has opened, from its own list. Paths come back with / even on Windows.
known_vaults() {
	local config=""
	for candidate in \
		"${APPDATA:-}/obsidian/obsidian.json" \
		"$HOME/Library/Application Support/obsidian/obsidian.json" \
		"${XDG_CONFIG_HOME:-$HOME/.config}/obsidian/obsidian.json"; do
		if [ -f "$candidate" ]; then config="$candidate"; break; fi
	done
	[ -n "$config" ] || return 0
	grep -o '"path":"[^"]*"' "$config" | sed 's/^"path":"//; s/"$//; s/\\\\/\//g' | while IFS= read -r path; do
		if command -v cygpath >/dev/null 2>&1; then cygpath -u "$path"; else echo "$path"; fi
	done
}

if [ -z "$vault" ]; then
	vaults=()
	while IFS= read -r line; do
		if [ -n "$line" ] && [ -d "$line/.obsidian" ]; then vaults+=("$line"); fi
	done < <(known_vaults)
	if [ "${#vaults[@]}" -eq 0 ]; then
		fail "could not find an Obsidian vault. Run again with the folder: install.sh /path/to/vault"
	elif [ "${#vaults[@]}" -eq 1 ]; then
		vault="${vaults[0]}"
		log "Vault: $vault"
	else
		echo "Which vault?"
		for i in "${!vaults[@]}"; do echo "  $((i + 1))) ${vaults[$i]}"; done
		# stdin is the script itself when piped from curl, so ask on the terminal.
		[ -r /dev/tty ] || fail "several vaults found and no terminal to ask on. Run again with the folder."
		read -r -p "Number: " choice < /dev/tty
		case "$choice" in
		'' | *[!0-9]*) fail "not a number: $choice" ;;
		esac
		[ "$choice" -ge 1 ] && [ "$choice" -le "${#vaults[@]}" ] || fail "no such choice: $choice"
		vault="${vaults[$((choice - 1))]}"
	fi
fi

[ -d "$vault" ] || fail "not a folder: $vault"
[ -d "$vault/.obsidian" ] || fail "not an Obsidian vault (no .obsidian folder): $vault"
target="$vault/.obsidian/plugins/$PLUGIN_ID"

# --- get and check the files, before anything in the vault is written -------------

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fetch() { # name
	local name="$1" url="$base/$1"
	if curl -fsSL "$url" -o "$work/$name" 2>/dev/null; then return 0; fi
	# A private repository gives curl a 404; the GitHub CLI, if the member has it and is signed in, can still read it.
	if [ -z "${DOCS_PUBLISHER_BASE_URL:-}" ] && command -v gh >/dev/null 2>&1; then
		local tag="${version:-}"
		if gh release download ${tag:+"$tag"} -R "$REPO" -p "$name" -D "$work" --clobber >/dev/null 2>&1; then return 0; fi
	fi
	fail "could not download $name from $url. Check your connection, or ask the person who looks after the plugin."
}

sha256_of() {
	if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

if [ "$local_mode" -eq 1 ]; then
	here="$(cd "$(dirname "$0")" && pwd)"
	for name in $FILES; do
		[ -f "$here/$name" ] || fail "$name not found next to the script: run 'npm run build' first"
		cp "$here/$name" "$work/$name"
	done
	log "Installing the local build"
else
	if [ -n "${DOCS_PUBLISHER_BASE_URL:-}" ]; then
		base="$DOCS_PUBLISHER_BASE_URL"
	elif [ -n "$version" ]; then
		base="https://github.com/$REPO/releases/download/$version"
	else
		base="https://github.com/$REPO/releases/latest/download"
	fi
	log "Downloading from $base"
	for name in $FILES SHA256SUMS; do fetch "$name"; done
	for name in $FILES; do
		expected="$(grep "  $name\$" "$work/SHA256SUMS" | cut -d' ' -f1)"
		[ -n "$expected" ] || fail "SHA256SUMS has no entry for $name"
		[ "$(sha256_of "$work/$name")" = "$expected" ] || fail "$name does not match its checksum, so nothing was installed. Try again; if it repeats, tell whoever looks after the plugin."
	done
fi

new_version="$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$work/manifest.json" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
grep -q "\"id\"[[:space:]]*:[[:space:]]*\"$PLUGIN_ID\"" "$work/manifest.json" || fail "this is not the Docs Publisher plugin (manifest id is wrong), so nothing was installed"

old_version=""
if [ -f "$target/manifest.json" ]; then
	old_version="$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$target/manifest.json" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
fi

# --- install ----------------------------------------------------------------------

mkdir -p "$target"
for name in $FILES; do cp "$work/$name" "$target/$name"; done

# List the plugin as enabled. Obsidian's file is a JSON array of plugin ids.
list="$vault/.obsidian/community-plugins.json"
if [ ! -f "$list" ]; then
	printf '["%s"]\n' "$PLUGIN_ID" > "$list"
elif ! grep -q "\"$PLUGIN_ID\"" "$list"; then
	content="$(tr -d '\r\n' < "$list")"
	case "$content" in
	'['*']')
		cp "$list" "$list.bak"
		body="$(printf '%s' "$content" | sed 's/^[[:space:]]*\[//; s/\][[:space:]]*$//')"
		if [ -z "$(printf '%s' "$body" | tr -d '[:space:]')" ]; then
			printf '["%s"]\n' "$PLUGIN_ID" > "$list"
		else
			printf '[%s, "%s"]\n' "$body" "$PLUGIN_ID" > "$list"
		fi
		;;
	*) log "Could not read $list, so the plugin was not switched on there. Switch it on in Obsidian's settings." ;;
	esac
fi

if [ -z "$old_version" ]; then
	log "Installed Docs Publisher ${new_version:-?} in $target"
elif [ "$old_version" = "$new_version" ]; then
	log "Docs Publisher ${new_version:-?} was already installed; its files were refreshed."
else
	log "Updated Docs Publisher $old_version -> ${new_version:-?}"
fi
log "Your settings were kept."
log "Next: in Obsidian, open Settings > Community plugins, turn community plugins on if they are off,"
log "then switch Docs Publisher on (or off and on again after an update). The panel opens from the git-branch icon."
