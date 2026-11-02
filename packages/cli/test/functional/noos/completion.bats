# completion where the backend is noos: the scripts, installing them, and what they complete.

# bats file_tags=eco:noos

# Preconditions: a noos project on attach-no-os-lib's test fixtures (a capi, a platform with
# testboard, otherboard and twobusboard, drivers), target otherboard, no workfile yet.
# BASH_FILE, FISH_FILE and ZSH_FILE are where --install writes each shell's script, inside the
# test's home. candidates lists what the completion engine offers; bash_complete what the bash
# script offers on Tab.
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

# Description: completion prints the completion script for bash, fish and zsh.
# Steps:
#   1. Run completion bash; check it succeeds, with the complete -F line for analog-attach.
#   2. Run completion fish; check it succeeds, with a complete -c analog-attach line.
#   3. Run completion zsh; check it succeeds, starting with #compdef analog-attach.
# bats test_tags=req:COMPLETION-01, id:N0038
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

# Description: completion without a shell prints the script of the shell in $SHELL.
# Steps:
#   1. Run completion with SHELL=/usr/bin/zsh; check it succeeds with the zsh script.
#   2. Run completion with SHELL=/bin/bash; check it succeeds with the bash script.
# bats test_tags=req:COMPLETION-01, id:N0039
@test "completion without a shell prints the script of the user's shell" {
	SHELL=/usr/bin/zsh run aa completion
	assert_success
	assert_line --index 0 "#compdef analog-attach"
	SHELL=/bin/bash run aa completion
	assert_success
	assert_line "complete -F _analog_attach_complete analog-attach"
}

# Description: completion refuses a shell it has no script for, naming the supported ones.
# Steps:
#   1. Run completion tcsh; check it exits 0 and says tcsh is unknown, listing bash, fish, zsh.
#   2. Run completion with SHELL=/bin/sh; check it exits 0 and asks to name one of bash, fish,
#      zsh.
# bats test_tags=req:COMPLETION-01, id:N0040
@test "completion refuses a shell it has no script for" {
	run aa completion tcsh
	assert_success  # a refused value: the command ran (GEN-09)
	assert_output --partial "Unknown shell: tcsh. Supported: bash, fish, zsh"
	SHELL=/bin/sh run aa completion
	assert_success  # a refused value: the command ran (GEN-09)
	assert_output --partial "Name one: bash, fish, zsh"
}

# Description: with --json, completion gives the script in the result.
# Steps:
#   1. Run completion bash, with --json.
#   2. Check it succeeds (.ok true), with the bash script in .script.
# bats test_tags=req:COMPLETION-01, id:N0041
@test "completion --json gives the script" {
	run_json completion bash
	assert_success
	assert_json '.ok' true
	assert_json '.script | test("complete -F _analog_attach_complete analog-attach")' true
}

# --- Installing -----------------------------------------------------------------------------

# Description: completion --install writes each shell's script where that shell loads it
# without any setup.
# Steps:
#   1. For bash, fish and zsh, run completion <shell> --install; check it succeeds.
#   2. Check the script file is there, and the output names its path.
#   3. Check the file is the same as what completion <shell> prints.
# bats test_tags=req:COMPLETION-02, id:N0042
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

# Description: completion --install replaces a script installed before.
# Steps:
#   1. Write an old script at the bash completion path.
#   2. Run completion bash --install; check it succeeds.
#   3. Check the old text is gone and the file is the script completion bash prints.
# bats test_tags=req:COMPLETION-02, id:N0043
@test "completion --install replaces an earlier script" {
	mkdir -p "$(dirname "$BASH_FILE")"
	echo "an old script" >"$BASH_FILE"
	run aa completion bash --install
	assert_success
	run grep -c "an old script" "$BASH_FILE"
	assert_output 0
	diff <(aa completion bash) "$BASH_FILE"
}

# Description: completion --install leaves the shells' startup files alone, and writes nothing
# else in the home.
# Steps:
#   1. Write a .bashrc and a .zshrc in the home.
#   2. Run completion --install for bash, fish and zsh.
#   3. Check .bashrc and .zshrc are unchanged, and there is no .profile, .bash_profile or fish
#      config.fish.
#   4. Check the only files in the home are the two startup files and the three scripts.
# bats test_tags=req:COMPLETION-02, id:N0044
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

# Description: completion --uninstall removes the installed script.
# Steps:
#   1. For bash, fish and zsh, install the script with completion <shell> --install.
#   2. Run completion <shell> --uninstall; check it succeeds, saying it removed the file.
#   3. Check the file is gone.
# bats test_tags=req:COMPLETION-03, id:N0045
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

# Description: completion --uninstall with nothing installed says it was not installed.
# Steps:
#   1. Run completion bash --uninstall, with --json, before any install.
#   2. Check it succeeds, the message saying it is not installed.
# bats test_tags=req:COMPLETION-03, id:N0046
@test "completion --uninstall with nothing installed says so" {
	run_json completion bash --uninstall
	assert_success
	assert_json '.message | test("not installed")' true
}

# --- What it completes ----------------------------------------------------------------------

# Description: completion offers the commands, and narrows them to the typed prefix.
# Steps:
#   1. Complete an empty command word; check it offers validate, generate, build, deploy and
#      skill.
#   2. Complete gen; check it offers only generate.
# bats test_tags=req:COMPLETION-04, id:N0047
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

# Description: completion offers a command's flags, and the values of a flag.
# Steps:
#   1. Complete build --; check it offers --clean and not --board.
#   2. Complete generate --; check it offers --output and --project-template.
#   3. Complete deploy --probe with an empty word; check it offers openocd and jlink, in order.
# bats test_tags=req:COMPLETION-04, id:N0048
@test "completion offers a command's flags" {
	run candidates build --
	assert_line --clean
	refute_line --board
	run candidates generate --
	assert_line --output
	assert_line --project-template
	run candidates deploy --probe ''
	assert_output "$(printf 'openocd\njlink')"
}

# Description: completion offers the setting names and their values, as config gives them.
# Steps:
#   1. Complete config with an empty word; check it offers the settings config --json lists, in
#      the same order.
#   2. Complete config probe; check it offers openocd and jlink.
#   3. Complete config interview; check it offers true and false.
# bats test_tags=req:COMPLETION-04, id:N0049
@test "completion offers the setting names and their values, as config has them" {
	run candidates config ''
	assert_output "$(aa --json config | jq -r '.configs[].field_name')"
	run candidates config probe ''
	assert_output "$(printf 'openocd\njlink')"
	run candidates config interview ''
	assert_output "$(printf 'true\nfalse')"
}

# Description: completion of add offers the device keys that list devices lists.
# Steps:
#   1. Create the workfile with init.
#   2. Get the device keys from list devices, with --json; check there are some.
#   3. Complete add with an empty word; check it offers the same keys.
#   4. Complete add eval; check it offers only eval-testpart.
# bats test_tags=req:COMPLETION-04, id:N0050
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

# Description: completion offers the device names that list property lists, for read, update,
# delete and rename.
# Steps:
#   1. Create the workfile and add the eval-testpart board.
#   2. For read, update, delete and rename, complete an empty first argument.
#   3. Check each offers the names list property gives, with --json.
# bats test_tags=req:COMPLETION-04, id:N0051
@test "completion offers the device names list property lists" {
	with_sensor
	local command
	for command in read update delete rename; do
		run candidates "$command" ''
		assert_output "$(aa --json list property | jq -r '.names[]')"
	done
}

# Description: completion offers a device's properties, as list property gives them.
# Steps:
#   1. Create the workfile and add the eval-testpart board.
#   2. Complete read testpart_spi_dev with an empty word; check it offers the properties list
#      property testpart_spi_dev gives.
#   3. Do the same for update testpart_spi_dev.
# bats test_tags=req:COMPLETION-04, id:N0052
@test "completion offers a device's properties as list property lists them" {
	with_sensor
	run candidates read testpart_spi_dev ''
	assert_output "$(aa --json list property testpart_spi_dev | jq -r '.names[]')"
	run candidates update testpart_spi_dev ''
	assert_output "$(aa --json list property testpart_spi_dev | jq -r '.names[]')"
}

# Description: completion offers a property's values, as list value gives them, without the
# schemas list value says it could create.
# Steps:
#   1. Create the workfile and add the eval-testpart board.
#   2. For testpart_spi_dev mode, testpart_spi_dev controller and testpart_cs_gpio port_handle,
#      complete update <node> <property> with an empty word.
#   3. Check each offers the values list value gives, with --json, leaving out the "can create"
#      ones.
# bats test_tags=req:COMPLETION-04, id:N0053
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

# Description: the bash script completes through the CLI when bash calls it on Tab.
# Steps:
#   1. Create the workfile and add the eval-testpart board.
#   2. Load completion bash's script in bash with the CLI on PATH, and complete each line.
#   3. Check analog-attach gen gives generate, and read testpart_s gives testpart_spi_dev.
#   4. Check update testpart_spi_dev gives its properties, controller and cs_gpio among them,
#      and update testpart_spi_dev mode gives TEST_SPI_MODE_0.
#   5. Check config probe j gives jlink.
# bats test_tags=req:COMPLETION-04, id:N0054
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
