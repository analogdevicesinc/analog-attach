# completion where the backend is linux: the scripts, installing them, and what they complete.

# bats file_tags=eco:linux

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
	assert_output --partial "Unknown shell: tcsh. Supported: bash, fish, zsh"
	SHELL=/bin/sh run aa completion
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
	assert_line move
	assert_line enable
	assert_line disable
	assert_line build
	assert_line deploy
	refute_line generate
	run candidates mo
	assert_output move
}

# bats test_tags=req:COMPLETION-04
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

# bats test_tags=req:COMPLETION-04
@test "completion offers the setting names and their values, as config has them" {
	run candidates config ''
	assert_output "$(aa --json config | jq -r '.configs[].field_name')"
	run candidates config overlay-syntax ''
	assert_output "$(printf 'fragment\nlabel')"
	run candidates config backend ''
	assert_output "$(printf 'linux\nnoos')"
}

# bats test_tags=req:COMPLETION-04
@test "completion offers the device types list devices lists" {
	with_overlay
	# To files: both are longer than a pipe takes at once.
	aa --json list devices >"$BATS_TEST_TMPDIR/devices.json"
	aa __complete -- add '' >"$BATS_TEST_TMPDIR/complete.txt"
	local devices
	devices=$(jq -r '.devices[].key' "$BATS_TEST_TMPDIR/devices.json")
	[ "$(wc -l <<<"$devices")" -gt 1000 ] || fail "list devices lists too little"
	[ "$(grep -v '^__ANALOG_ATTACH_COMPLETE_' "$BATS_TEST_TMPDIR/complete.txt" | cut -f1)" = "$devices" ] ||
		fail "completion and list devices differ"
	run candidates add adi,ad7124
	assert_output "$(printf 'adi,ad7124-4\nadi,ad7124-8')"
}

# bats test_tags=req:COMPLETION-04
@test "completion offers the values of add's flags: the parents list parent gives, and the templates" {
	with_overlay
	run candidates add adi,adxl345 --parent ''
	assert_output "$(aa --json list parent adi,adxl345 | jq -r '.suggestions[] | "\(.value)/"')"
	run candidates add adi,adxl345 --template ''
	assert_line required
	assert_line example:1
	assert_line overlay:rpi-adxl345-overlay.dts
}

# bats test_tags=req:COMPLETION-04
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

# bats test_tags=req:COMPLETION-04
@test "completion offers a node's properties as list property lists them, set ones first" {
	with_devices
	run candidates read i2c_arm/adi,adxl345@0 ''
	assert_output "$(aa --json list property i2c_arm/adi,adxl345@0 | jq -r '.names[]')"
	run aa __complete -- update adxl345 ''
	assert_line --index 0 $'__ANALOG_ATTACH_COMPLETE_GROUP__\tset'
	assert_line $'__ANALOG_ATTACH_COMPLETE_GROUP__\tnot set'
	assert_line --regexp $'^compatible\t'
	assert_line --regexp $'^interrupts\trequired$'
	# The child nodes a binding's pattern names.
	run candidates update ad7124_8 channel@1
	assert_line channel@1
	assert_line channel@15
}

# bats test_tags=req:COMPLETION-04
@test "completion offers a property's values as list value lists them" {
	with_devices
	run candidates update adxl345 interrupt-parent ''
	assert_output "$(aa --json list value adxl345 interrupt-parent | jq -r '.suggestions[].value')"
	assert_line gpio
}

# bats test_tags=req:COMPLETION-04
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
