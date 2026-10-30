# completion where the backend is noos: the scripts, installing them, and what they complete.

# bats file_tags=eco:noos

setup() {
	load ../helpers
	new_project noos
	# Where --install writes, inside the test's home whatever the machine sets.
	export XDG_DATA_HOME="$HOME/.local/share"
	BASH_FILE="$XDG_DATA_HOME/bash-completion/completions/analog-attach"
	FISH_FILE="$XDG_CONFIG_HOME/fish/completions/analog-attach.fish"
	ZSH_FILE="$XDG_DATA_HOME/zsh/site-functions/_analog-attach"
}

# `candidates <words>`: the values the engine offers for the last word (empty: a new word).
candidates() {
	aa __complete -- "$@" | grep -v '^__ANALOG_ATTACH_COMPLETE_' | cut -f1
}

# `bash_complete <line>`: what the bash script offers at the end of <line>, as bash would
# call it on Tab, with the CLI on PATH as `analog-attach`.
bash_complete() {
	local bin="$BATS_TEST_TMPDIR/bin"
	mkdir -p "$bin"
	printf '#!/bin/sh\nexec node "%s/dist/cli.js" "$@"\n' "$CLI_DIR" >"$bin/analog-attach"
	chmod +x "$bin/analog-attach"
	aa completion bash >"$BATS_TEST_TMPDIR/completion.bash"
	PATH="$bin:$PATH" bash -c '
		source "$1"
		COMP_LINE=$2
		COMP_POINT=${#COMP_LINE}
		read -ra COMP_WORDS <<<"$COMP_LINE"
		[[ "$COMP_LINE" == *" " ]] && COMP_WORDS+=("")
		COMP_CWORD=$(( ${#COMP_WORDS[@]} - 1 ))
		_analog_attach_complete 2>/dev/null
		printf "%s\n" "${COMPREPLY[@]}"
	' bash "$BATS_TEST_TMPDIR/completion.bash" "$1"
}

# --- The script -----------------------------------------------------------------------------

# bats test_tags=req:COMPLETION-01
@test "completion prints the script for bash, fish and zsh" {
	run aa completion bash
	assert_success
	assert_line "complete -F _analog_attach_complete analog-attach"
	run aa completion fish
	assert_success
	assert_line --partial "complete -c analog-attach"
	run aa completion zsh
	assert_success
	assert_line --index 0 "#compdef analog-attach"
}

# bats test_tags=req:COMPLETION-01
@test "completion without a shell prints the script of the user's shell" {
	SHELL=/usr/bin/zsh run aa completion
	assert_success
	assert_line --index 0 "#compdef analog-attach"
	SHELL=/bin/bash run aa completion
	assert_line "complete -F _analog_attach_complete analog-attach"
}

# bats test_tags=req:COMPLETION-01
@test "completion refuses a shell it has no script for" {
	run aa completion tcsh
	assert_failure 2
	assert_output --partial "Unknown shell: tcsh. Supported: bash, fish, zsh"
	SHELL=/bin/sh run aa completion
	assert_failure 2
	assert_output --partial "Name one: bash, fish, zsh"
}

# bats test_tags=req:COMPLETION-01
@test "completion --json gives the script" {
	run_json completion bash
	assert_success
	assert_json '.ok' true
	assert_json '.script | test("complete -F _analog_attach_complete analog-attach")' true
}

# --- Installing -----------------------------------------------------------------------------

# bats test_tags=req:COMPLETION-02
@test "completion --install puts each shell's script where the shell loads it by itself" {
	local shell file
	for shell in bash fish zsh; do
		run aa completion "$shell" --install
		assert_success
		case $shell in
			bash) file=$BASH_FILE ;;
			fish) file=$FISH_FILE ;;
			zsh) file=$ZSH_FILE ;;
		esac
		[ -f "$file" ] || fail "$shell: no $file"
		assert_output --partial "$file"
		# The file is the script the command prints.
		diff <(aa completion "$shell") "$file"
	done
}

# bats test_tags=req:COMPLETION-02
@test "completion --install replaces an earlier script" {
	mkdir -p "$(dirname "$BASH_FILE")"
	echo "an old script" >"$BASH_FILE"
	run aa completion bash --install
	assert_success
	run grep -c "an old script" "$BASH_FILE"
	assert_output 0
	diff <(aa completion bash) "$BASH_FILE"
}

# bats test_tags=req:COMPLETION-02
@test "completion --install edits no shell startup file" {
	echo "# my bashrc" >"$HOME/.bashrc"
	echo "# my zshrc" >"$HOME/.zshrc"
	local shell
	for shell in bash fish zsh; do
		aa completion "$shell" --install >/dev/null
	done
	run cat "$HOME/.bashrc"
	assert_output "# my bashrc"
	run cat "$HOME/.zshrc"
	assert_output "# my zshrc"
	[ ! -e "$HOME/.profile" ]
	[ ! -e "$HOME/.bash_profile" ]
	[ ! -e "$XDG_CONFIG_HOME/fish/config.fish" ]
	# Nothing else written in the home: the three scripts, and the test's own files.
	run bash -c "cd '$HOME' && find . -type f | sort"
	assert_output "$(printf '%s\n' ./.bashrc ./.config/fish/completions/analog-attach.fish \
		./.local/share/bash-completion/completions/analog-attach ./.local/share/zsh/site-functions/_analog-attach ./.zshrc |
		sort)"
}

# bats test_tags=req:COMPLETION-03
@test "completion --uninstall removes the installed script" {
	local shell file
	for shell in bash fish zsh; do
		aa completion "$shell" --install >/dev/null
		case $shell in
			bash) file=$BASH_FILE ;;
			fish) file=$FISH_FILE ;;
			zsh) file=$ZSH_FILE ;;
		esac
		run aa completion "$shell" --uninstall
		assert_success
		assert_output --partial "Removed $file"
		[ ! -e "$file" ]
	done
}

# bats test_tags=req:COMPLETION-03
@test "completion --uninstall with nothing installed says so" {
	run_json completion bash --uninstall
	assert_success
	assert_json '.message | test("not installed")' true
}

# --- What it completes ----------------------------------------------------------------------

# bats test_tags=req:COMPLETION-04
@test "completion offers the commands" {
	run candidates ''
	assert_line validate
	assert_line generate
	assert_line build
	assert_line deploy
	assert_line skill
	run candidates gen
	assert_output generate
}

# bats test_tags=req:COMPLETION-04
@test "completion offers a command's flags" {
	run candidates build --
	assert_line --board
	assert_line --clean
	run candidates generate --
	assert_line --output
	assert_line --project-template
	run candidates deploy --probe ''
	assert_output "$(printf 'openocd\njlink')"
}

# bats test_tags=req:COMPLETION-04
@test "completion offers the setting names and their values, as config has them" {
	run candidates config ''
	assert_output "$(aa --json config | jq -r '.configs[].field_name')"
	run candidates config probe ''
	assert_output "$(printf 'openocd\njlink')"
	run candidates config interview ''
	assert_output "$(printf 'true\nfalse')"
}

# bats test_tags=req:COMPLETION-04
@test "completion offers the device types list devices lists" {
	aa init >/dev/null
	local devices
	devices=$(aa --json list devices | jq -r '.devices[].key')
	[ -n "$devices" ] || fail "list devices lists nothing"
	run candidates add ''
	assert_output "$devices"
	run candidates add eval
	assert_output eval-testpart
}

# bats test_tags=req:COMPLETION-04
@test "completion offers the device names list property lists" {
	with_sensor
	local command
	for command in read update delete rename; do
		run candidates "$command" ''
		assert_output "$(aa --json list property | jq -r '.names[]')"
	done
}

# bats test_tags=req:COMPLETION-04
@test "completion offers a device's properties as list property lists them" {
	with_sensor
	run candidates read testpart_spi_dev ''
	assert_output "$(aa --json list property testpart_spi_dev | jq -r '.names[]')"
	run candidates update testpart_spi_dev ''
	assert_output "$(aa --json list property testpart_spi_dev | jq -r '.names[]')"
}

# bats test_tags=req:COMPLETION-04
@test "completion offers a property's values as list value lists them" {
	with_sensor
	local node property
	for property in testpart_spi_dev:mode testpart_spi_dev:controller testpart_cs_gpio:port_handle; do
		node=${property%%:*}
		property=${property#*:}
		run candidates update "$node" "$property" ''
		# Without the schemas list value says it could create.
		assert_output "$(aa --json list value "$node" "$property" |
			jq -r '.suggestions[] | select((.display_string // "") | test("can create") | not) | .value')"
	done
}

# bats test_tags=req:COMPLETION-04
@test "the bash script completes through the CLI, as bash calls it on Tab" {
	with_sensor
	run bash_complete "analog-attach gen"
	assert_output generate
	run bash_complete "analog-attach read testpart_s"
	assert_output testpart_spi_dev
	run bash_complete "analog-attach update testpart_spi_dev "
	assert_line controller
	assert_line cs_gpio
	run bash_complete "analog-attach update testpart_spi_dev mode "
	assert_output TEST_SPI_MODE_0
	run bash_complete "analog-attach config probe j"
	assert_output jlink
}
