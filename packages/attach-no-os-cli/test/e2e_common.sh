#!/bin/bash
# Shared driver for the end-to-end tests: create a workfile, configure a device,
# generate a no-OS project and build it. Nothing is mocked — this uses the real CLI
# and the real no-OS build system.
#
# A per-device test script sources this file, sets PROJECT_NAME (and optionally
# TARGET_MCU / BOARD), defines a `configure_nodes` function, and calls `run_e2e`.
# Everything else — paths, workfile creation, validation, generation, build,
# cleanup — lives here so the device scripts stay just the interesting part.
#
#   source "$(dirname "$0")/e2e_common.sh"
#   PROJECT_NAME="e2e_test_foo"
#   configure_nodes() { $AA add --name ... --key ...; $AA update ...; }
#   run_e2e
#
# no-OS builds with CMake and Kconfig, so a project is pinned to a *board*, not to
# the PLATFORM/TARGET pair the Make build system took from the environment. The
# board travels inside the generated CMakePresets.json, which is why the build step
# here passes nothing at all.
#
# Both project layouts are covered, selected with E2E_MODE:
#   out-of-tree  the project is generated into the test's temporary directory and is
#                its own top-level CMake source. This is the default: it leaves the
#                no-OS checkout untouched.
#   in-tree      the project is generated into <no-OS>/projects/<name>, which is the
#                only layout projects/CMakeLists.txt can descend into.
#
# Environment knobs:
#   NOOS_PATH             path to the no-OS checkout (default: $HOME/adi/no-OS)
#   E2E_MODE              out-of-tree (default) or in-tree
#   BOARD                 board to build for (default: ad-apard32690-sl)
#   E2E_SKIP_CLI_BUILD=1  reuse an existing dist/cli.js (the all-devices runner
#                         builds once instead of once per device)
#
# Requires cmake >= 3.28, ninja, and a toolchain for the board's vendor SDK on
# PATH; the build step checks for them up front rather than failing deep inside a
# CMake configure.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(dirname "$SCRIPT_DIR")"
NOOS_PATH="${NOOS_PATH:-$HOME/adi/no-OS}"

# Defaults a device script may override before calling run_e2e.
TARGET_MCU="${TARGET_MCU:-max32690}"
# Configured rather than left to `aa generate`, so the test asserts on one fixed board
# instead of whichever one the platform happens to resolve to. max32690 has exactly
# one board today; max32650 has two, and there generation would refuse to guess.
BOARD="${BOARD:-ad-apard32690-sl}"
E2E_MODE="${E2E_MODE:-out-of-tree}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"
    rm -rf "$TEST_DIR"
    # In-tree runs put a project and a build directory inside the developer's no-OS
    # checkout, so both go again. Out-of-tree runs leave nothing outside $TEST_DIR;
    # these are no-ops then.
    rm -rf "$NOOS_PATH/projects/$PROJECT_NAME"
    rm -rf "$NOOS_PATH/build/$PROJECT_NAME-$BOARD"
}

run_e2e() {
    if [ -z "$PROJECT_NAME" ]; then
        echo -e "${RED}FAIL: the test script must set PROJECT_NAME${NC}"
        exit 1
    fi
    if ! declare -F configure_nodes > /dev/null; then
        echo -e "${RED}FAIL: the test script must define configure_nodes()${NC}"
        exit 1
    fi

    if [ "$E2E_MODE" != "in-tree" ] && [ "$E2E_MODE" != "out-of-tree" ]; then
        echo -e "${RED}FAIL: E2E_MODE must be 'in-tree' or 'out-of-tree', got '$E2E_MODE'${NC}"
        exit 1
    fi

    TEST_DIR=$(mktemp -d)
    trap cleanup EXIT

    # Where the project is generated, and so which of the two CMake layouts is
    # exercised. In-tree has to be exactly <no-OS>/projects/<name>.
    if [ "$E2E_MODE" = "in-tree" ]; then
        OUTPUT_DIR="$NOOS_PATH/projects"
    else
        OUTPUT_DIR="$TEST_DIR/out"
    fi
    PROJECT_DIR="$OUTPUT_DIR/$PROJECT_NAME"

    echo -e "${YELLOW}=== E2E Build Test: $PROJECT_NAME ($E2E_MODE) ===${NC}"
    echo "Test directory: $TEST_DIR"
    echo "no-OS path: $NOOS_PATH"
    echo "Chip: $TARGET_MCU"
    echo "Board: $BOARD"
    echo ""

    # Build the CLI first
    if [ "$E2E_SKIP_CLI_BUILD" = "1" ]; then
        echo -e "${YELLOW}[1/9] Reusing existing CLI build...${NC}"
    else
        echo -e "${YELLOW}[1/9] Building CLI...${NC}"
        cd "$CLI_DIR"
        yarn build > /dev/null 2>&1
    fi
    AA="node $CLI_DIR/dist/cli.js"

    # Fail here rather than 8 steps later inside a CMake configure. `aa build` checks
    # the same things, but by then the run has already spent a minute.
    echo -e "${YELLOW}[2/9] Checking build tools...${NC}"
    for tool in cmake ninja; do
        if ! command -v "$tool" > /dev/null; then
            echo -e "${RED}FAIL: $tool is not on PATH${NC}"
            if [ "$tool" = "ninja" ]; then
                echo "Every no-OS board preset names ninja as its generator: apt install ninja-build"
            fi
            exit 1
        fi
    done
    if [ ! -f "$NOOS_PATH/CMakePresets.json" ]; then
        echo -e "${RED}FAIL: no CMakePresets.json in $NOOS_PATH — that checkout predates the CMake build system${NC}"
        exit 1
    fi
    echo -e "${GREEN}OK: cmake, ninja and a CMake-era no-OS checkout${NC}"

    # Set up config.
    #
    # Written as a project-local config in $TEST_DIR rather than with `aa
    # tool-config-set`, which writes the *global* one: the run then leaves the
    # developer's own configuration alone, and every command below can be invoked with
    # no arguments at all — which is exactly how attach-meta dispatches them.
    echo -e "${YELLOW}[3/9] Configuring paths...${NC}"
    cd "$TEST_DIR"

    cat > .analog-attach.json <<EOF
{
  "no_os_path": "$NOOS_PATH",
  "workfile": "workfile.json",
  "board": "$BOARD",
  "project_name": "$PROJECT_NAME",
  "output_path": "$OUTPUT_DIR",
  "project_path": "$PROJECT_DIR"
}
EOF

    # Create workfile. Configured by board rather than platform, which is the primary
    # way in: the board settles the platform on its own, so this also checks that the
    # derived platform is the one the device nodes below are loaded from.
    echo -e "${YELLOW}[4/9] Creating workfile for $BOARD...${NC}"
    $AA create-workfile

    if [ ! -f "workfile.json" ]; then
        echo -e "${RED}FAIL: workfile.json not created${NC}"
        exit 1
    fi

    if ! grep -q "\"platform\": \"$TARGET_MCU\"" workfile.json; then
        echo -e "${RED}FAIL: board $BOARD did not derive platform $TARGET_MCU${NC}"
        cat workfile.json
        exit 1
    fi
    echo -e "${GREEN}OK: workfile.json created (platform $TARGET_MCU derived from $BOARD)${NC}"

    # Device-specific nodes. A device is a descriptor node paired with its init_param
    # struct; the init_param references a no-OS comm init_param, which in turn
    # references the platform (Maxim) one.
    echo -e "${YELLOW}[5/9] Creating and configuring device nodes...${NC}"
    configure_nodes
    echo -e "${GREEN}OK: Device configured${NC}"

    # Validate
    echo -e "${YELLOW}[6/9] Validating workfile...${NC}"
    # A protocol ValidationResponse is `{"errors": [...], "warnings": [...]}` and has no
    # ok/valid field of its own — an empty `errors` is what "valid" means. Warnings are
    # deliberately not fatal here.
    VALIDATE_OUTPUT=$($AA validate --json 2>&1)
    if echo "$VALIDATE_OUTPUT" | grep -q '"errors": \[\]'; then
        echo -e "${GREEN}OK: Validation passed${NC}"
    else
        echo -e "${RED}FAIL: Validation errors:${NC}"
        echo "$VALIDATE_OUTPUT"
        exit 1
    fi

    # Generate project
    # Name, output directory and board all come from the config written above, so this
    # is the zero-argument dispatch attach-meta performs.
    echo -e "${YELLOW}[7/9] Generating no-OS project ($E2E_MODE)...${NC}"
    $AA generate

    if [ ! -d "$PROJECT_DIR" ]; then
        echo -e "${RED}FAIL: Project not generated${NC}"
        exit 1
    fi
    echo -e "${GREEN}OK: Project generated at $PROJECT_DIR${NC}"

    # List generated files
    echo "Generated files:"
    find "$PROJECT_DIR" -type f | sort | while read -r f; do
        echo "  $f"
    done

    # Check the build files before spending a build on them: a project that is
    # missing one of these, or whose preset points at another board, fails much
    # later and much less clearly.
    echo -e "${YELLOW}[8/9] Checking generated build files...${NC}"
    for required in CMakeLists.txt CMakePresets.json project.conf; do
        if [ ! -f "$PROJECT_DIR/$required" ]; then
            echo -e "${RED}FAIL: $required was not generated${NC}"
            exit 1
        fi
    done
    if ! grep -q "^CONFIG_[A-Z0-9_]*=y" "$PROJECT_DIR/project.conf"; then
        echo -e "${RED}FAIL: project.conf enables no Kconfig symbol — no driver would be compiled${NC}"
        cat "$PROJECT_DIR/project.conf"
        exit 1
    fi
    # The board is recorded as the `project` preset's parent, which is what lets the
    # build step below take no arguments at all.
    if ! grep -q "\"inherits\": \"$BOARD\"" "$PROJECT_DIR/CMakePresets.json"; then
        echo -e "${RED}FAIL: CMakePresets.json does not pin the project to $BOARD${NC}"
        cat "$PROJECT_DIR/CMakePresets.json"
        exit 1
    fi
    # Eta renders a missing context key as the literal string "undefined", which is
    # valid CMake and valid Kconfig, so it would otherwise pass silently.
    if grep -rn "undefined" "$PROJECT_DIR"; then
        echo -e "${RED}FAIL: a generated file contains \"undefined\" (a template context key is missing)${NC}"
        exit 1
    fi
    echo -e "${GREEN}OK: CMakeLists.txt, CMakePresets.json and project.conf look sane${NC}"

    # Build the project using aa build. Nothing is passed: the project directory comes
    # from the `project_path` setting, the board from the generated preset, and the mode
    # from where the project sits. No PLATFORM/TARGET in the environment either.
    echo -e "${YELLOW}[9/9] Building project with aa build...${NC}"

    BUILD_LOG="/tmp/build_output_${PROJECT_NAME}.log"
    # pipefail is required here: without it the `if` sees tail's exit status (always
    # 0) instead of aa build's, so a failed build gets reported as a pass.
    set -o pipefail
    if $AA build 2>&1 | tee "$BUILD_LOG" | tail -20; then
        echo -e "${GREEN}OK: Build successful${NC}"
    else
        echo -e "${RED}FAIL: Build failed${NC}"
        echo "Last 50 lines of build output:"
        tail -50 "$BUILD_LOG"
        exit 1
    fi

    # kconfiglib does not fail a configure over an unsatisfiable `depends on`; it
    # warns and leaves the symbol at n, and the driver then goes missing at link
    # time. When it does link anyway, the warning is the only sign the defconfig is
    # short a symbol, so it is a failure here.
    if grep -n "unsatisfied direct dependencies" "$BUILD_LOG"; then
        echo -e "${RED}FAIL: Kconfig reported unsatisfied dependencies — project.conf is missing a symbol${NC}"
        exit 1
    fi

    # Spelled out per mode rather than read back from the build log, so that a change
    # to where artifacts land fails this test instead of passing unnoticed. Mirrors
    # BuildPlan.elf_path in src/build/cmake_build.ts.
    if [ "$E2E_MODE" = "in-tree" ]; then
        ELF="$NOOS_PATH/build/$PROJECT_NAME-$BOARD/build/$PROJECT_NAME.elf"
    else
        ELF="$PROJECT_DIR/build/$BOARD/build/$PROJECT_NAME.elf"
    fi
    if [ ! -f "$ELF" ]; then
        echo -e "${RED}FAIL: no ELF at $ELF${NC}"
        exit 1
    fi
    echo -e "${GREEN}OK: $ELF${NC}"
    size "$ELF" 2>/dev/null || arm-none-eabi-size "$ELF" 2>/dev/null || true

    echo ""
    echo -e "${GREEN}=== $PROJECT_NAME: ALL TESTS PASSED ===${NC}"
}
