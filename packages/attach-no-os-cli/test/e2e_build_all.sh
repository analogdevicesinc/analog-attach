#!/bin/bash
# Run every end-to-end test. The CLI is built once up front and each test reuses that
# build (E2E_SKIP_CLI_BUILD), so this is not 4x the work.
#
# Three device tests cover the schema and codegen side out-of-tree; the fourth builds
# one of them again in-tree, which is the only difference the generated CMakeLists.txt
# cares about. Covering every device in both layouts would double the runtime to test
# the same twenty lines of CMake twice.
#
# Keeps going after a failure so one broken device does not hide the others, then
# prints a summary and exits non-zero if anything failed.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

TESTS=(
    "e2e_build.sh"           # adxl355 — SPI + union
    "e2e_build_adt7420.sh"   # adt7420 — I2C + $switch override
    "e2e_build_ad7124.sh"    # ad7124  — SPI + pointer init_param + arrays
    "e2e_build_in_tree.sh"   # adxl355 again, generated inside <no-OS>/projects
)

echo -e "${YELLOW}=== Building CLI once for all device tests ===${NC}"
cd "$CLI_DIR"
if ! yarn build > /dev/null 2>&1; then
    echo -e "${RED}FAIL: CLI build failed${NC}"
    exit 1
fi
export E2E_SKIP_CLI_BUILD=1

FAILED=()
for test in "${TESTS[@]}"; do
    echo ""
    echo -e "${YELLOW}--------------------------------------------------${NC}"
    if "$SCRIPT_DIR/$test"; then
        :
    else
        FAILED+=("$test")
    fi
done

echo ""
echo -e "${YELLOW}=== Summary ===${NC}"
for test in "${TESTS[@]}"; do
    if [[ " ${FAILED[*]} " == *" $test "* ]]; then
        echo -e "  ${RED}FAIL${NC}  $test"
    else
        echo -e "  ${GREEN}PASS${NC}  $test"
    fi
done

if [ ${#FAILED[@]} -gt 0 ]; then
    echo -e "\n${RED}${#FAILED[@]} of ${#TESTS[@]} device tests failed${NC}"
    exit 1
fi
echo -e "\n${GREEN}All ${#TESTS[@]} device tests passed${NC}"
