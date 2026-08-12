#!/bin/bash
# Shared driver for the end-to-end tests: create a workfile, configure a device,
# generate a no-OS project and build it. Nothing is mocked — this uses the real CLI
# and the real no-OS build system.
#
# A per-device test script sources this file, sets PROJECT_NAME (and optionally
# TARGET_MCU / PLATFORM_NAME), defines a `configure_nodes` function, and calls
# `run_e2e`. Everything else — paths, workfile creation, validation, generation,
# build, cleanup — lives here so the device scripts stay just the interesting part.
#
#   source "$(dirname "$0")/e2e_common.sh"
#   PROJECT_NAME="e2e_test_foo"
#   configure_nodes() { $AA create node ...; $AA update ...; }
#   run_e2e
#
# Environment knobs:
#   NOOS_PATH             path to the no-OS checkout (default: $HOME/adi/no-OS)
#   E2E_SKIP_CLI_BUILD=1  reuse an existing dist/cli.js (the all-devices runner
#                         builds once instead of once per device)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$(dirname "$CLI_DIR")")"
NOOS_PATH="${NOOS_PATH:-$HOME/adi/no-OS}"

# Defaults a device script may override before calling run_e2e.
TARGET_MCU="${TARGET_MCU:-max32690}"
PLATFORM_NAME="${PLATFORM_NAME:-maxim}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"
    rm -rf "$TEST_DIR"
    # Clean up generated project in no-OS if it exists
    rm -rf "$NOOS_PATH/projects/$PROJECT_NAME"
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

    TEST_DIR=$(mktemp -d)
    trap cleanup EXIT

    echo -e "${YELLOW}=== E2E Build Test: $PROJECT_NAME ===${NC}"
    echo "Test directory: $TEST_DIR"
    echo "no-OS path: $NOOS_PATH"
    echo "Target: $PLATFORM_NAME/$TARGET_MCU"
    echo ""

    # Build the CLI first
    if [ "$E2E_SKIP_CLI_BUILD" = "1" ]; then
        echo -e "${YELLOW}[1/8] Reusing existing CLI build...${NC}"
    else
        echo -e "${YELLOW}[1/8] Building CLI...${NC}"
        cd "$CLI_DIR"
        yarn build > /dev/null 2>&1
    fi
    AA="node $CLI_DIR/dist/cli.js"

    # Set up config
    echo -e "${YELLOW}[2/8] Configuring paths...${NC}"
    cd "$TEST_DIR"

    # Point to the test schemas
    export ATTACH_SCHEMAS_PATH="$REPO_ROOT/packages/attach-no-os-lib/test/bindings/schemas"
    $AA config no_os_path "$NOOS_PATH"

    # Create workfile
    echo -e "${YELLOW}[3/8] Creating workfile for $TARGET_MCU...${NC}"
    $AA create workfile --platform "$TARGET_MCU"

    if [ ! -f "workfile.json" ]; then
        echo -e "${RED}FAIL: workfile.json not created${NC}"
        exit 1
    fi
    echo -e "${GREEN}OK: workfile.json created${NC}"

    # Device-specific nodes. A device is a descriptor node paired with its init_param
    # struct; the init_param references a no-OS comm init_param, which in turn
    # references the platform (Maxim) one.
    echo -e "${YELLOW}[4/8] Creating device nodes...${NC}"
    echo -e "${YELLOW}[5/8] Configuring device...${NC}"
    configure_nodes
    echo -e "${GREEN}OK: Device configured${NC}"

    # Validate
    echo -e "${YELLOW}[6/8] Validating workfile...${NC}"
    VALIDATE_OUTPUT=$($AA validate --json 2>&1)
    if echo "$VALIDATE_OUTPUT" | grep -q '"valid": true'; then
        echo -e "${GREEN}OK: Validation passed${NC}"
    else
        echo -e "${RED}FAIL: Validation errors:${NC}"
        echo "$VALIDATE_OUTPUT"
        exit 1
    fi

    # Generate project
    echo -e "${YELLOW}[7/8] Generating no-OS project...${NC}"
    $AA generate "$PROJECT_NAME" --output "$NOOS_PATH/projects"

    if [ ! -d "$NOOS_PATH/projects/$PROJECT_NAME" ]; then
        echo -e "${RED}FAIL: Project not generated${NC}"
        exit 1
    fi
    echo -e "${GREEN}OK: Project generated at $NOOS_PATH/projects/$PROJECT_NAME${NC}"

    # List generated files
    echo "Generated files:"
    find "$NOOS_PATH/projects/$PROJECT_NAME" -type f | sort | while read -r f; do
        echo "  $f"
    done

    # Build the project using aa build
    echo -e "${YELLOW}[8/8] Building project with aa build...${NC}"

    # The build needs PLATFORM and TARGET set
    export PLATFORM="$PLATFORM_NAME"
    export TARGET="$TARGET_MCU"

    BUILD_LOG="/tmp/build_output_${PROJECT_NAME}.log"
    # pipefail is required here: without it the `if` sees tail's exit status (always
    # 0) instead of aa build's, so a failed build gets reported as a pass.
    set -o pipefail
    if $AA build "$NOOS_PATH/projects/$PROJECT_NAME" 2>&1 | tee "$BUILD_LOG" | tail -20; then
        echo -e "${GREEN}OK: Build successful${NC}"
    else
        echo -e "${RED}FAIL: Build failed${NC}"
        echo "Last 50 lines of build output:"
        tail -50 "$BUILD_LOG"
        exit 1
    fi

    echo ""
    echo -e "${GREEN}=== $PROJECT_NAME: ALL TESTS PASSED ===${NC}"
}
