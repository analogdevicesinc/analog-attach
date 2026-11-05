# completion where the backend is linux: the scripts, installing them, and what they complete.

# bats file_tags=eco:linux

# Preconditions: a linux project on the Linux tree with the RPi 4 base devicetree, no workfile
# yet, and BASH_FILE, FISH_FILE and ZSH_FILE the places in the test's home where --install
# writes each shell's script. with_devices makes an overlay with an ADXL345 on i2c1 and an
# AD7124-8 on spi0.
setup() {
	load ../helpers
	new_project linux
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

# `with_devices`: an overlay with an ADXL345 on i2c1 (i2c_arm/adi,adxl345@0, label adxl345)
# and an AD7124-8 on spi0 (spi0/adi,ad7124-8@2, label ad7124_8).
with_devices() {
	with_overlay
	aa add adi,adxl345 --parent i2c1 >/dev/null 2>&1 || fail "add adi,adxl345 failed"
	aa add adi,ad7124-8 --parent spi0 >/dev/null 2>&1 || fail "add adi,ad7124-8 failed"
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
#   1. Run completion bash and check it succeeds with the bash complete -F line.
#   2. Run completion fish and check it succeeds with a complete -c analog-attach line.
#   3. Run completion zsh and check it succeeds, starting with #compdef analog-attach.
# bats test_tags=req:COMPLETION-01, id:L0041
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

# Description: completion without a shell prints the script for the shell in $SHELL.
# Steps:
#   1. Run completion with SHELL zsh and check it succeeds with the zsh script.
#   2. Run completion with SHELL bash and check it prints the bash script.
# bats test_tags=req:COMPLETION-01, id:L0042
@test "completion without a shell prints the script of the user's shell" {
	SHELL=/usr/bin/zsh run aa completion
	assert_success
	assert_line --index 0 "#compdef analog-attach"
	SHELL=/bin/bash run aa completion
	assert_line "complete -F _analog_attach_complete analog-attach"
}

# Description: completion refuses a shell it has no script for, whether named or taken from
# $SHELL, listing the supported shells.
# Steps:
#   1. Run completion tcsh and check the message says tcsh is unknown and lists bash, fish, zsh.
#   2. Run completion with SHELL sh and check the message asks to name one of bash, fish, zsh.
# bats test_tags=req:COMPLETION-01, id:L0043
@test "completion refuses a shell it has no script for" {
	run aa completion tcsh
	assert_output --partial "Unknown shell: tcsh. Supported: bash, fish, zsh"
	SHELL=/bin/sh run aa completion
	assert_output --partial "Name one: bash, fish, zsh"
}

# Description: completion with --json gives the script in a JSON field.
# Steps:
#   1. Run completion bash, with --json.
#   2. Check it succeeds (.ok true) and .script holds the bash complete -F line.
# bats test_tags=req:COMPLETION-01, id:L0044
@test "completion --json gives the script" {
	run_json completion bash
	assert_success
	assert_json '.ok' true
	assert_json '.script | test("complete -F _analog_attach_complete analog-attach")' true
}

# --- Installing -----------------------------------------------------------------------------

# Description: completion --install writes the bash and fish scripts to the folder each shell
# loads completions from by itself, and names the file.
# Steps:
#   1. For bash and fish, run completion <shell> --install.
#   2. Check each succeeds, the file exists at its place and the output names it.
#   3. Check each file is the script completion <shell> prints.
# bats test_tags=req:COMPLETION-02, id:L0045
@test "completion --install puts the bash and fish scripts where the shell loads them by itself" {
	local shell file
	for shell in bash fish; do
		run aa completion "$shell" --install
		assert_success
		case $shell in
			bash) file=$BASH_FILE ;;
			fish) file=$FISH_FILE ;;
		esac
		[ -f "$file" ] || fail "$shell: no $file"
		assert_output --partial "$file"
		# The file is the script the command prints.
		diff <(aa completion "$shell") "$file"
	done
}

# Gap: zsh has no folder of the user's that it loads by itself; the script goes to
# $XDG_DATA_HOME/zsh/site-functions and the CLI asks for an fpath line in ~/.zshrc, which it
# doesn't write (COMPLETION-02 forbids editing a startup file).
# Description: completion zsh --install writes the zsh script where zsh loads it by itself, with
# nothing left for the user to add to a startup file.
# Steps:
#   1. Run completion zsh --install.
#   2. Check it succeeds, the file exists at its place and the output names it.
#   3. Check the file is the script completion zsh prints.
#   4. Check the output asks for no fpath line in ~/.zshrc.
# bats test_tags=req:COMPLETION-02, gap, id:L0350
@test "completion --install puts the zsh script where zsh loads it by itself" {
	run aa completion zsh --install
	assert_success
	[ -f "$ZSH_FILE" ] || fail "zsh: no $ZSH_FILE"
	assert_output --partial "$ZSH_FILE"
	diff <(aa completion zsh) "$ZSH_FILE"
	# The gap: last, so the checks above hold while it is open.
	refute_output --partial "fpath"
}

# Description: completion --install replaces a script installed earlier.
# Steps:
#   1. Write an old script at the bash completion file's place.
#   2. Run completion bash --install and check it succeeds.
#   3. Check the old content is gone and the file is the current bash script.
# bats test_tags=req:COMPLETION-02, id:L0046
@test "completion --install replaces an earlier script" {
	mkdir -p "$(dirname "$BASH_FILE")"
	echo "an old script" >"$BASH_FILE"
	run aa completion bash --install
	assert_success
	run grep -c "an old script" "$BASH_FILE"
	assert_output 0
	diff <(aa completion bash) "$BASH_FILE"
}

# Description: completion --install leaves the shells' startup files alone and writes nothing but
# the three scripts in the home.
# Steps:
#   1. Write a .bashrc and a .zshrc in the home.
#   2. Run completion --install for bash, fish and zsh.
#   3. Check .bashrc and .zshrc are unchanged, and no .profile, .bash_profile or fish config.fish
#      was created.
#   4. Check the only files in the home are the two startup files and the three scripts.
# bats test_tags=req:COMPLETION-02, id:L0047
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

# Description: completion --uninstall removes the script --install wrote, and names it.
# Steps:
#   1. For bash, fish and zsh, run completion <shell> --install, then completion <shell>
#      --uninstall.
#   2. Check each uninstall succeeds and says it removed the file.
#   3. Check the file is gone.
# bats test_tags=req:COMPLETION-03, id:L0048
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

# Description: completion --uninstall with no script installed says it is not installed.
# Steps:
#   1. Run completion bash --uninstall, with --json.
#   2. Check it succeeds and the message says it is not installed.
# bats test_tags=req:COMPLETION-03, id:L0049
@test "completion --uninstall with nothing installed says so" {
	run_json completion bash --uninstall
	assert_success
	assert_json '.message | test("not installed")' true
}

# --- What it completes ----------------------------------------------------------------------

# Description: completion of the first word offers the commands of linux, and completes a prefix
# to its command.
# Steps:
#   1. Ask the completion engine for the first word.
#   2. Check it offers exactly the linux commands, in order: config, init, import, add, read,
#      update, delete, rename, list, move, enable, disable, validate, build, deploy, completion,
#      skill and help (so not generate).
#   3. Ask for the word mo and check it offers only move.
# bats test_tags=req:COMPLETION-04, id:L0050
@test "completion offers the commands" {
	run candidates ''
	assert_output "$(printf '%s\n' config init import add read update delete rename list move \
		enable disable validate build deploy completion skill help)"
	run candidates mo
	assert_output move
}

# Description: completion offers a command's flags after --, and list's subcommands.
# Steps:
#   1. Ask the engine for add --, and check it offers --name, --parent, --label, --template and
#      --quiet.
#   2. Ask for delete -- and check it offers --force.
#   3. Ask for the word after list and check it offers exactly devices, property, value, parent
#      and overlay, in that order.
# bats test_tags=req:COMPLETION-04, id:L0051
@test "completion offers a command's flags" {
	run candidates add --
	assert_line --name
	assert_line --parent
	assert_line --label
	assert_line --template
	assert_line --quiet
	run candidates delete --
	assert_line --force
	run candidates list ''
	assert_output "$(printf 'devices\nproperty\nvalue\nparent\noverlay')"
}

# Description: completion offers the setting names config lists, and a setting's options as its
# values.
# Steps:
#   1. Ask the engine for the word after config and check it is the settings config --json lists.
#   2. Ask for the value of overlay-syntax and check it offers fragment and label.
#   3. Ask for the value of backend and check it offers linux and noos.
# bats test_tags=req:COMPLETION-04, id:L0052
@test "completion offers the setting names and their values, as config has them" {
	run candidates config ''
	assert_output "$(aa --json config | jq -r '.configs[].field_name')"
	run candidates config overlay-syntax ''
	assert_output "$(printf 'fragment\nlabel')"
	run candidates config backend ''
	assert_output "$(printf 'linux\nnoos')"
}

# Description: completion of add's device type offers the device types list devices lists, and
# completes a prefix.
# Steps:
#   1. Create the overlay with init.
#   2. Write list devices, with --json, and the engine's offers for add to files.
#   3. Check list devices lists more than 1000 types and the offers are the same ones (sorted:
#      list devices orders them by category, the shell sorts the offers).
#   4. Ask for add adi,ad7124 and check it offers adi,ad7124-4 and adi,ad7124-8.
# bats test_tags=req:COMPLETION-04, id:L0053
@test "completion offers the device types list devices lists" {
	with_overlay
	# To files: both are longer than a pipe takes at once.
	aa --json list devices >"$BATS_TEST_TMPDIR/devices.json"
	aa __complete -- add '' >"$BATS_TEST_TMPDIR/complete.txt"
	local devices
	devices=$(jq -r '.devices[].key' "$BATS_TEST_TMPDIR/devices.json" | LC_ALL=C sort)
	[ "$(wc -l <<<"$devices")" -gt 1000 ] || fail "list devices lists too little"
	[ "$(grep -v '^__ANALOG_ATTACH_COMPLETE_' "$BATS_TEST_TMPDIR/complete.txt" | cut -f1 | LC_ALL=C sort)" = "$devices" ] ||
		fail "completion and list devices differ"
	run candidates add adi,ad7124
	assert_output "$(printf 'adi,ad7124-4\nadi,ad7124-8')"
}

# Description: completion offers the values of add's flags: --parent the parents list parent
# gives, and --template the templates of the device.
# Steps:
#   1. Create the overlay with init.
#   2. Ask the engine for add adi,adxl345 --parent and check it offers the list parent
#      suggestions, each followed by /.
#   3. Ask for add adi,adxl345 --template and check it offers required, example:1 and
#      overlay:rpi-adxl345-overlay.dts.
# bats test_tags=req:COMPLETION-04, id:L0054
@test "completion offers the values of add's flags: the parents list parent gives, and the templates" {
	with_overlay
	run candidates add adi,adxl345 --parent ''
	assert_output "$(aa --json list parent adi,adxl345 | jq -r '.suggestions[] | "\(.value)/"')"
	run candidates add adi,adxl345 --template ''
	assert_line required
	assert_line example:1
	assert_line overlay:rpi-adxl345-overlay.dts
}

# Description: completion of a node path offers the overlay's nodes one path segment at a time,
# for every command that takes a node.
# Steps:
#   1. Make the overlay with the ADXL345 and the AD7124-8 (with_devices).
#   2. For read, update, delete, rename, move, enable and disable, ask the engine for the node
#      word, and check it offers i2c_arm/ and spi0/ with no space after.
#   3. Ask for read i2c_arm/ and check it offers i2c_arm/adi,adxl345@0.
#   4. Ask for a full path prefix /soc/i2c@7e804000/adi,adxl and check it completes the node.
# bats test_tags=req:COMPLETION-04, id:L0055
@test "completion offers the overlay's nodes, one path segment at a time" {
	with_devices
	local command
	for command in read update delete rename move enable disable; do
		run aa __complete -- "$command" ''
		assert_line __ANALOG_ATTACH_COMPLETE_NOSPACE__
		assert_line i2c_arm/
		assert_line spi0/
	done
	run candidates read i2c_arm/
	assert_output i2c_arm/adi,adxl345@0
	run candidates read /soc/i2c@7e804000/adi,adxl
	assert_output /soc/i2c@7e804000/adi,adxl345@0
}

# Description: completion of a property offers the node's properties as list property lists
# them, set ones grouped first, and the child nodes its binding names.
# Steps:
#   1. Make the overlay with the ADXL345 and the AD7124-8.
#   2. Ask the engine for the property of read i2c_arm/adi,adxl345@0 and check it is the list
#      property --json names.
#   3. Ask for the property of update adxl345; check the set group comes first with compatible
#      in it, and interrupts, marked required, is in the not set group.
#   4. Ask for update ad7124_8 channel@1 and check it offers channel@1 and channel@15.
# bats test_tags=req:COMPLETION-04, id:L0056
@test "completion offers a node's properties as list property lists them, set ones first" {
	with_devices
	run candidates read i2c_arm/adi,adxl345@0 ''
	assert_output "$(aa --json list property i2c_arm/adi,adxl345@0 | jq -r '.names[]')"
	run aa __complete -- update adxl345 ''
	assert_line --index 0 $'__ANALOG_ATTACH_COMPLETE_GROUP__\tset'
	assert_line $'__ANALOG_ATTACH_COMPLETE_GROUP__\tnot set'
	assert_line --regexp $'^compatible\t'
	assert_line --regexp $'^interrupts\trequired$'
	local not_set compatible interrupts
	not_set=$(grep -nxF $'__ANALOG_ATTACH_COMPLETE_GROUP__\tnot set' <<<"$output" | cut -d: -f1)
	compatible=$(grep -n $'^compatible\t' <<<"$output" | cut -d: -f1)
	interrupts=$(grep -nxF $'interrupts\trequired' <<<"$output" | cut -d: -f1)
	[ "$compatible" -lt "$not_set" ] || fail "compatible is not in the set group"
	[ "$interrupts" -gt "$not_set" ] || fail "interrupts is not in the not set group"
	# The child nodes a binding's pattern names.
	run candidates update ad7124_8 channel@1
	assert_line channel@1
	assert_line channel@15
}

# Description: completion of a property's value offers the values list value lists for it.
# Steps:
#   1. Make the overlay with the ADXL345 and the AD7124-8.
#   2. Ask the engine for the value of update adxl345 interrupt-parent.
#   3. Check the offers are the list value --json suggestions, among them gpio.
# bats test_tags=req:COMPLETION-04, id:L0057
@test "completion offers a property's values as list value lists them" {
	with_devices
	run candidates update adxl345 interrupt-parent ''
	assert_output "$(aa --json list value adxl345 interrupt-parent | jq -r '.suggestions[].value')"
	assert_line gpio
}

# Description: the bash script, run as bash runs it on Tab, completes commands, nodes, properties,
# values and settings through the CLI.
# Steps:
#   1. Make the overlay with the ADXL345 and the AD7124-8.
#   2. Complete analog-attach mo with the bash script and check it gives move.
#   3. Check read i2c_arm/ gives i2c_arm/adi,adxl345@0.
#   4. Check update adxl345 interrupt-p gives interrupt-parent, and its value gp gives gpio.
#   5. Check config overlay-syntax l gives label.
# bats test_tags=req:COMPLETION-04, id:L0058
@test "the bash script completes through the CLI, as bash calls it on Tab" {
	with_devices
	run bash_complete "analog-attach mo"
	assert_output move
	run bash_complete "analog-attach read i2c_arm/"
	assert_output i2c_arm/adi,adxl345@0
	run bash_complete "analog-attach update adxl345 interrupt-p"
	assert_output interrupt-parent
	run bash_complete "analog-attach update adxl345 interrupt-parent gp"
	assert_output gpio
	run bash_complete "analog-attach config overlay-syntax l"
	assert_output label
}
