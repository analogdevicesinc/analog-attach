# Loaded by the end-to-end tests where the backend is linux, after ../helpers:
# `setup() { load ../helpers; load linux-helpers; FIXTURE=...; new_project linux; }`.
#
# Each story ends the same way: the overlay compared with its fixture ($FIXTURE), built,
# deployed, and the fixture imported in a new project and built again.

# `same_as_fixture`: the workfile is $FIXTURE, byte for byte. With AA_E2E_UPDATE=1 the fixture
# is rewritten from the workfile first, when the bindings or the printer change on purpose.
same_as_fixture() {
	if [ "${AA_E2E_UPDATE:-}" = 1 ]; then
		cp "$WORKFILE" "$FIXTURE"
	fi
	diff "$FIXTURE" "$WORKFILE" || fail "the workfile differs from $FIXTURE"
}

# `builds_into_dtbo <compatible>...`: build, with --json, writes build/overlay.dtbo, a flattened
# devicetree whose decompiled text has each of the compatibles.
builds_into_dtbo() {
	local dtbo="$PROJECT/build/overlay.dtbo" compatible
	run_json build
	assert_success
	assert_json '.ok' true
	assert_json '.path' "$dtbo"
	[ "$(head -c 4 "$dtbo" | od -An -tx1 | tr -d ' ')" = d00dfeed ] || fail "$dtbo is not a .dtbo"
	run "$CLI_DIR/bundled/linux/tools/dtc" -I dtb -O dts "$dtbo"
	assert_success
	for compatible in "$@"; do
		assert_output --partial "compatible = \"$compatible\";"
	done
}

# `deploys`: deploy of the built .dtbo succeeds. With AA_DEPLOY_IP (AA_DEPLOY_USER, pi, and
# AA_DEPLOY_PASSWORD, raspberry, by default) it copies it to that Raspberry Pi and reboots it;
# otherwise a stand-in deploy-command copies it to deployed.dtbo in the project.
deploys() {
	local dtbo="$PROJECT/build/overlay.dtbo"
	if [ -n "${AA_DEPLOY_IP:-}" ]; then
		need scp sshpass
		aa config deploy-ip "$AA_DEPLOY_IP" >/dev/null
		aa config deploy-user "${AA_DEPLOY_USER:-pi}" >/dev/null
		aa config deploy-password "${AA_DEPLOY_PASSWORD:-raspberry}" >/dev/null
		run aa deploy
		assert_success
		assert_output "Deployed $dtbo to ${AA_DEPLOY_USER:-pi}@$AA_DEPLOY_IP:/boot/overlays/ and rebooted"
	else
		aa config deploy-command 'cp {dtbo} deployed.dtbo' >/dev/null
		run_json deploy
		assert_success
		assert_json '.message' "Deployed $dtbo with 'cp {dtbo} deployed.dtbo'"
		cmp -s "$dtbo" "$PROJECT/deployed.dtbo" || fail "the deploy-command didn't get $dtbo"
	fi
}

# `fixture_builds_again`: in a new project ($PROJECT becomes it), import of $FIXTURE starts a
# workfile named after it, which validates with no error nor warning and builds into the same
# .dtbo as the story's.
fixture_builds_again() {
	local first="$PROJECT/build/overlay.dtbo" stem
	stem=$(basename "$FIXTURE" .dtso)
	PROJECT="$BATS_TEST_TMPDIR/again"
	mkdir -p "$PROJECT"
	cd "$PROJECT" || fail "no $PROJECT"
	new_project linux
	run aa import "$FIXTURE"
	assert_success
	assert_output --partial "Imported $FIXTURE into $PROJECT/$stem.dtso"
	run_json validate
	assert_json '.errors | length' 0
	assert_json '.warnings | length' 0
	run_json build
	assert_json '.ok' true
	assert_json '.path' "$PROJECT/build/$stem.dtbo"
	cmp -s "$first" "$PROJECT/build/$stem.dtbo" || fail "the imported fixture builds into another .dtbo"
}
