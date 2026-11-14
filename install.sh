#!/usr/bin/env bash
# Flywheel installer for Linux and macOS: builds and installs the Flywheel compiler, and
# optionally Pulley (the package manager) and the VS Code extension.
#
#   curl -fsSL https://flywheel.polymorphia.dev/install.sh | bash
#   curl -fsSL https://flywheel.polymorphia.dev/install.sh | bash -s -- --all
#
# Run with --help for options. Nothing is installed system-wide except the build dependencies
# from your distribution's package manager, which are listed and confirmed before sudo is used.
# On macOS they come from Homebrew (no sudo) and Apple's Command Line Tools.
#
# The whole script is inside functions and `main` runs on the last line, so a partially
# downloaded copy does nothing.

set -euo pipefail

FLYWHEEL_REPO="${FLYWHEEL_REPO:-https://github.com/fwlang/flywheel}"
PULLEY_REPO="${PULLEY_REPO:-https://github.com/fwlang/pulley}"
VSCODE_REPO="${VSCODE_REPO:-https://github.com/fwlang/vscode-flywheel}"
EXTENSION_ID="fwlang.flywheel-language"
LLVM_MIN=21
LLVM_MAX=23
LLVM_DEFAULT=21
CMAKE_MIN=3.24
PYTHON_MIN=3.12
NODE_MIN=22
PATH_MARK="# >>> flywheel >>>"
PATH_END="# <<< flywheel <<<"

# ---------------------------------------------------------------------------------------------
# Options

prefix="${FLYWHEEL_PREFIX:-$HOME/.local/flywheel}"
ref="main"
source_dir=""
pulley_source=""
vscode_source=""
want_pulley=""
want_vscode=""
assume_yes=0
install_deps=1
modify_path=1
desktop="AUTO"
jobs=""
dry_run=0
uninstall=0
keep_build=0

usage() {
    cat <<EOF
Install Flywheel on Linux or macOS.

Usage: install.sh [options]

Components
  --pulley              also install Pulley, the package manager (needs Python $PYTHON_MIN+)
  --vscode              also install the VS Code extension (needs VS Code and Node.js $NODE_MIN+)
  --all                 install all three
  --no-pulley, --no-vscode
                        skip without asking
                        (without these flags you are asked when run in a terminal)

Where and what
  --prefix DIR          install Flywheel into DIR (default: ~/.local/flywheel)
  --ref REF             branch, tag, or commit to build (default: main)
  --source DIR          build Flywheel from a local checkout instead of downloading
  --pulley-source DIR   install Pulley from a local checkout
  --vscode-source DIR   build the extension from a local checkout
  --desktop MODE        desktop window support: auto (default), on, off
  --jobs N              parallel build jobs (default: number of CPUs)

Behaviour
  -y, --yes             answer yes to every question (for scripts and CI)
  --no-deps             do not install packages; fail if something is missing
  --no-modify-path      do not add Flywheel to PATH in your shell startup files
  --keep-build          keep the build directory (printed at the end)
  --dry-run             print what would be done without changing anything
  --uninstall           remove Flywheel (and Pulley / the extension if installed)
  -h, --help            show this help

Environment
  FLYWHEEL_PREFIX       same as --prefix
  NO_COLOR              disable coloured output
EOF
}

parse_args() {
    while (($#)); do
        case "$1" in
        --pulley) want_pulley=1 ;;
        --no-pulley) want_pulley=0 ;;
        --vscode) want_vscode=1 ;;
        --no-vscode) want_vscode=0 ;;
        --all) want_pulley=1 want_vscode=1 ;;
        --prefix) prefix="${2:?--prefix needs a directory}"; shift ;;
        --prefix=*) prefix="${1#*=}" ;;
        --ref) ref="${2:?--ref needs a branch, tag, or commit}"; shift ;;
        --ref=*) ref="${1#*=}" ;;
        --source) source_dir="${2:?--source needs a directory}"; shift ;;
        --source=*) source_dir="${1#*=}" ;;
        --pulley-source) pulley_source="${2:?--pulley-source needs a directory}"; shift ;;
        --pulley-source=*) pulley_source="${1#*=}" ;;
        --vscode-source) vscode_source="${2:?--vscode-source needs a directory}"; shift ;;
        --vscode-source=*) vscode_source="${1#*=}" ;;
        --desktop) desktop="${2:?--desktop needs auto, on, or off}"; shift ;;
        --desktop=*) desktop="${1#*=}" ;;
        --jobs) jobs="${2:?--jobs needs a number}"; shift ;;
        --jobs=*) jobs="${1#*=}" ;;
        -y | --yes) assume_yes=1 ;;
        --no-deps) install_deps=0 ;;
        --no-modify-path) modify_path=0 ;;
        --keep-build) keep_build=1 ;;
        --dry-run) dry_run=1 ;;
        --uninstall) uninstall=1 ;;
        -h | --help) usage; exit 0 ;;
        *) die "unknown option '$1' (see --help)" ;;
        esac
        shift
    done
    desktop="$(printf '%s' "$desktop" | tr '[:lower:]' '[:upper:]')"
    [[ "$desktop" =~ ^(AUTO|ON|OFF)$ ]] || die "--desktop must be auto, on, or off"
    [[ -z "$jobs" || "$jobs" =~ ^[1-9][0-9]*$ ]] || die "--jobs must be a positive number"
    prefix="${prefix/#\~/$HOME}"
    [[ "$prefix" = /* ]] || prefix="$PWD/$prefix"
    if [[ -n "$source_dir" ]]; then
        source_dir="$(cd "$source_dir" && pwd)" || die "--source: no such directory"
        [[ -f "$source_dir/CMakeLists.txt" ]] || die "--source: $source_dir is not a Flywheel checkout"
    fi
    if [[ -n "$pulley_source" ]]; then
        pulley_source="$(cd "$pulley_source" && pwd)" || die "--pulley-source: no such directory"
        [[ -f "$pulley_source/pyproject.toml" ]] || die "--pulley-source: not a Pulley checkout"
        want_pulley="${want_pulley:-1}"
    fi
    if [[ -n "$vscode_source" ]]; then
        vscode_source="$(cd "$vscode_source" && pwd)" || die "--vscode-source: no such directory"
        [[ -f "$vscode_source/package.json" ]] || die "--vscode-source: not an extension checkout"
        want_vscode="${want_vscode:-1}"
    fi
}

# ---------------------------------------------------------------------------------------------
# Output and prompts

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
    bold=$'\e[1m' dim=$'\e[2m' red=$'\e[31m' green=$'\e[32m' yellow=$'\e[33m' blue=$'\e[34m' reset=$'\e[0m'
else
    bold="" dim="" red="" green="" yellow="" blue="" reset=""
fi
# Overall progress: main sets progress_total to the number of steps it will run; each step
# advances the bar. The same bar is drawn by install.ps1.
progress_total=0
progress_done=0
BAR_WIDTH=24

# bar DONE TOTAL: "[##########--------------]"
bar() {
    local filled=$(($1 * BAR_WIDTH / $2)) out="" i
    for ((i = 0; i < BAR_WIDTH; i++)); do
        if ((i < filled)); then out+="#"; else out+="-"; fi
    done
    printf '[%s]' "$out"
}

step() {
    local progress=""
    if ((progress_total > 0)); then
        progress_done=$((progress_done + 1))
        ((progress_done <= progress_total)) || progress_total=$progress_done
        progress="$(bar "$progress_done" "$progress_total") $progress_done/$progress_total  "
    fi
    printf '\n%s==>%s %s%s%s%s\n' "$blue" "$reset" "$dim$progress$reset" "$bold" "$*" "$reset"
}
info() { printf '    %s\n' "$*"; }
ok() { printf '    %s✓%s %s\n' "$green" "$reset" "$*"; }
warn() { printf '%swarning:%s %s\n' "$yellow" "$reset" "$*" >&2; }
die() {
    printf '%serror:%s %s\n' "$red" "$reset" "$*" >&2
    exit 1
}

# The terminal for questions, even when the script itself arrives on standard input.
has_tty() { [[ -r /dev/tty && -w /dev/tty ]] && { : </dev/tty; } 2>/dev/null; }

# ask "question" default(y/n): returns 0 for yes.
ask() {
    local question="$1" default="$2" answer hint
    if ((assume_yes)); then return 0; fi
    if ! has_tty; then [[ "$default" == y ]]; return; fi
    [[ "$default" == y ]] && hint="[Y/n]" || hint="[y/N]"
    printf '%s?%s %s %s ' "$yellow" "$reset" "$question" "$hint" >/dev/tty
    read -r answer </dev/tty || answer=""
    answer="${answer:-$default}"
    [[ "$answer" =~ ^[Yy] ]]
}

# Runs a command, or only prints it with --dry-run.
run() {
    printf '    %s$ %s%s\n' "$dim" "$*" "$reset" >&2
    ((dry_run)) || "$@"
}

as_root() {
    if ((EUID == 0)); then
        run "$@"
    elif command -v sudo >/dev/null; then
        run sudo "$@"
    elif command -v doas >/dev/null; then
        run doas "$@"
    else
        die "need root to run '$*', but neither sudo nor doas is available"
    fi
}

have() { command -v "$1" >/dev/null 2>&1; }

# version_ge 3.28.1 3.24 -> true. Numeric dotted versions only; done in bash because the sort
# on older macOS has no -V.
version_ge() {
    local IFS=. i a b
    # shellcheck disable=SC2206
    local x=($1) y=($2)
    for ((i = 0; i < ${#x[@]} || i < ${#y[@]}; i++)); do
        a="${x[i]:-0}" b="${y[i]:-0}"
        a="${a%%[!0-9]*}" b="${b%%[!0-9]*}"
        ((10#${a:-0} > 10#${b:-0})) && return 0
        ((10#${a:-0} < 10#${b:-0})) && return 1
    done
    return 0
}

cpu_count() { nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 2; }

# ---------------------------------------------------------------------------------------------
# Platform and packages

os=""
distro=""
detect_platform() {
    case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=macos; distro=macos; return ;;
    *) die "this installer is for Linux and macOS; on Windows use install.ps1" ;;
    esac
    local id="" like=""
    if [[ -r /etc/os-release ]]; then
        # shellcheck disable=SC1091
        id="$(. /etc/os-release && echo "${ID:-}")"
        like="$(. /etc/os-release && echo "${ID_LIKE:-}")"
    fi
    for candidate in $id $like; do
        case "$candidate" in
        arch | manjaro | endeavouros) distro=arch; return ;;
        debian | ubuntu | linuxmint | pop) distro=debian; return ;;
        fedora | rhel | centos | rocky | almalinux) distro=fedora; return ;;
        esac
    done
    distro=unknown
}

# Package names for a capability on the detected distribution.
packages_for() {
    case "$distro:$1" in
    arch:build) echo "base-devel cmake ninja curl tar" ;;
    arch:llvm) echo "llvm" ;;
    arch:compress) echo "zlib zstd" ;;
    arch:desktop) echo "pkgconf gtk3 webkit2gtk-4.1" ;;
    arch:pulley) echo "python python-pipx" ;;
    arch:node) echo "nodejs npm" ;;
    debian:build) echo "build-essential cmake ninja-build curl ca-certificates tar pkg-config" ;;
    debian:llvm) echo "llvm-$LLVM_DEFAULT-dev zlib1g-dev libzstd-dev" ;;
    debian:compress) echo "zlib1g-dev libzstd-dev" ;;
    debian:desktop) echo "pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev" ;;
    debian:pulley) echo "python3 python3-venv pipx" ;;
    debian:node) echo "nodejs npm" ;;
    fedora:build) echo "gcc-c++ make cmake ninja-build curl tar pkgconf" ;;
    fedora:llvm) echo "llvm-devel zlib-devel libzstd-devel" ;;
    fedora:compress) echo "zlib-devel libzstd-devel" ;;
    fedora:desktop) echo "pkgconf gtk3-devel webkit2gtk4.1-devel" ;;
    fedora:pulley) echo "python3 pipx" ;;
    fedora:node) echo "nodejs npm" ;;
    # Homebrew. curl, tar, zlib and the C++ compiler come with macOS and its Command Line Tools;
    # LLVM has its own step (brew_llvm_formula) and desktop windows need nothing extra.
    macos:build) echo "cmake ninja" ;;
    macos:compress) echo "zstd" ;;
    macos:pulley) echo "python@3.13 pipx" ;;
    macos:node) echo "node" ;;
    esac
}

# What each capability needs, for distributions this script cannot install packages on.
describe() {
    case "$1" in
    build) echo "a C++20 compiler (g++ or clang++), make or ninja, CMake $CMAKE_MIN+, curl, tar" ;;
    llvm) echo "LLVM $LLVM_MIN-$LLVM_MAX development files (llvm-config and LLVMConfig.cmake)" ;;
    compress) echo "zlib and zstd development files (zlib.h and zstd.h), which LLVM's CMake files require" ;;
    desktop) echo "pkg-config with GTK 3 and WebKitGTK 4.1 development files" ;;
    pulley) echo "Python $PYTHON_MIN+ and pipx" ;;
    node) echo "Node.js $NODE_MIN+ and npm" ;;
    esac
}

# install_for CAPABILITY: the distribution packages that provide it.
install_for() {
    local packages
    packages="$(packages_for "$1")"
    [[ -n "$packages" ]] ||
        die "this installer does not know your distribution's packages; please install $(describe "$1"), then rerun"
    # shellcheck disable=SC2086
    install_packages $packages
}

apt_updated=0
install_packages() {
    local packages=("$@")
    ((${#packages[@]})) || return 0
    if ((!install_deps)); then
        die "missing packages: ${packages[*]} (install them, or rerun without --no-deps)"
    fi
    if [[ "$os" == macos ]]; then
        find_brew
        info "These packages will be installed with Homebrew:"
        info "  ${packages[*]}"
        ask "Install them now?" y || die "cannot continue without: ${packages[*]}"
        run brew install "${packages[@]}"
        return
    fi
    info "These packages will be installed with your package manager:"
    info "  ${packages[*]}"
    ask "Install them now (uses sudo)?" y || die "cannot continue without: ${packages[*]}"
    case "$distro" in
    arch) as_root pacman -S --needed --noconfirm "${packages[@]}" ;;
    debian)
        if ((!apt_updated)); then
            as_root apt-get update
            apt_updated=1
        fi
        as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y "${packages[@]}"
        ;;
    fedora) as_root dnf install -y "${packages[@]}" ;;
    esac
}

# ---------------------------------------------------------------------------------------------
# macOS: Command Line Tools and Homebrew

# Homebrew lives in /opt/homebrew (Apple silicon) or /usr/local (Intel) and is not always on PATH
# in a fresh shell; this puts it there for the rest of the script.
brew_prefix=""
brew_found() {
    local candidate
    for candidate in "$(command -v brew 2>/dev/null || true)" /opt/homebrew/bin/brew /usr/local/bin/brew; do
        [[ -n "$candidate" && -x "$candidate" ]] || continue
        eval "$("$candidate" shellenv 2>/dev/null)" || true
        brew_prefix="$("$candidate" --prefix 2>/dev/null)" || continue
        return 0
    done
    return 1
}

find_brew() {
    [[ -n "$brew_prefix" ]] || brew_found ||
        die "the build dependencies on macOS come from Homebrew, which was not found; install it" \
            "from https://brew.sh (or install them yourself and rerun with --no-deps)"
}

# The C++ compiler and make come with Apple's Command Line Tools. Their installer is a GUI dialog
# that runs on its own, so this starts it and asks you to rerun once it has finished.
command_line_tools_ok() { xcode-select -p >/dev/null 2>&1 && c++ --version >/dev/null 2>&1; }

install_command_line_tools() {
    if ((!install_deps)); then
        die "a C++ compiler and make are required (install Apple's Command Line Tools: xcode-select --install)"
    fi
    info "Flywheel needs a C++ compiler and make, which come with Apple's Command Line Tools."
    ask "Open the Command Line Tools installer now?" y ||
        die "a C++ compiler is required (install it with: xcode-select --install)"
    run xcode-select --install || true
    ((dry_run)) || die "finish the Command Line Tools installation in the window that opened, then rerun this installer"
}

# Homebrew's plain "llvm" formula is whatever LLVM is current, which can be newer than Flywheel
# supports; then the versioned formula is used instead.
brew_llvm_formula() {
    local version major
    version="$(brew info llvm 2>/dev/null | sed -n 's/^==> llvm: stable \([0-9][0-9.]*\).*/\1/p' | head -n1)"
    major="${version%%.*}"
    if [[ -n "$major" ]] && ((major >= LLVM_MIN && major <= LLVM_MAX)); then
        echo llvm
    else
        echo "llvm@$LLVM_DEFAULT"
    fi
}

# ---------------------------------------------------------------------------------------------
# Downloads

work=""
cleanup() {
    if [[ -n "$work" && -d "$work" ]]; then
        if ((keep_build)); then
            info "build files kept in $work"
        else
            rm -rf "$work"
        fi
    fi
    return 0
}

make_workdir() {
    work="$(mktemp -d "${TMPDIR:-/tmp}/flywheel-install.XXXXXX")"
    trap cleanup EXIT
}

# fetch URL FILE
fetch() {
    if have curl; then
        run curl -fsSL --proto '=https' --tlsv1.2 --retry 3 -o "$2" "$1"
    elif have wget; then
        run wget -q --https-only -O "$2" "$1"
    else
        die "need curl or wget to download $1"
    fi
}

# copy_source FROM DIR: a local checkout, without its .git and build products.
copy_source() {
    run mkdir -p "$2"
    if ((!dry_run)); then
        tar -C "$1" --exclude=.git --exclude=node_modules --exclude=build --exclude=.venv \
            --exclude='*.vsix' -cf - . | tar -C "$2" -xf -
    fi
}

# download_source REPO DIR: the tree of $ref from a GitHub repository.
download_source() {
    local repo="$1" dir="$2" archive="$2.tar.gz"
    fetch "$repo/archive/$ref.tar.gz" "$archive" ||
        die "cannot download $repo at '$ref' (is the branch, tag, or commit right?)"
    run mkdir -p "$dir"
    # GitHub answers with an HTML page, not an error, for an empty repository.
    if ((!dry_run)) && ! gzip -t "$archive" 2>/dev/null; then
        die "$repo has no '$ref' to download (the repository may be empty or private)"
    fi
    run tar -xzf "$archive" -C "$dir" --strip-components=1
    run rm -f "$archive"
}

# ---------------------------------------------------------------------------------------------
# Flywheel

llvm_config=""
find_llvm() {
    local candidate version major
    llvm_config=""
    local candidates=(llvm-config llvm-config-{23,22,21} /usr/lib/llvm-{23,22,21}/bin/llvm-config
        /usr/lib/llvm{23,22,21}/bin/llvm-config)
    # Homebrew's LLVM is keg-only (not on PATH); MacPorts puts each version under libexec.
    if [[ -n "$brew_prefix" ]]; then
        candidates+=("$brew_prefix"/opt/llvm@{23,22,21}/bin/llvm-config "$brew_prefix/opt/llvm/bin/llvm-config")
    fi
    if [[ "$os" == macos ]]; then candidates+=(/opt/local/libexec/llvm-{23,22,21}/bin/llvm-config); fi
    for candidate in "${candidates[@]}"; do
        have "$candidate" || [[ -x "$candidate" ]] || continue
        version="$("$candidate" --version 2>/dev/null)" || continue
        major="${version%%.*}"
        if ((major >= LLVM_MIN && major <= LLVM_MAX)) &&
            [[ -f "$("$candidate" --cmakedir 2>/dev/null)/LLVMConfig.cmake" ]]; then
            llvm_config="$candidate"
            return 0
        fi
    done
    return 1
}

# Debian and Ubuntu often ship an older LLVM; apt.llvm.org provides current releases.
install_llvm_debian() {
    if apt-cache show "llvm-$LLVM_DEFAULT-dev" >/dev/null 2>&1; then
        install_packages "llvm-$LLVM_DEFAULT-dev" zlib1g-dev libzstd-dev
        return
    fi
    info "Your distribution does not package LLVM $LLVM_DEFAULT. It can be installed from the"
    info "LLVM project's own repository (apt.llvm.org), which this adds to your apt sources."
    ask "Add apt.llvm.org and install LLVM $LLVM_DEFAULT?" y ||
        die "LLVM $LLVM_MIN-$LLVM_MAX is required; install it and rerun"
    install_packages wget lsb-release gnupg software-properties-common
    fetch https://apt.llvm.org/llvm.sh "$work/llvm.sh"
    as_root bash "$work/llvm.sh" "$LLVM_DEFAULT"
    as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y "llvm-$LLVM_DEFAULT-dev" zlib1g-dev libzstd-dev
}

# LLVM's CMake files link LLVMSupport against ZLIB::ZLIB and zstd, but only look for them quietly,
# so missing headers surface later as "ZLIB::ZLIB but the target was not found".
compress_present() {
    local dirs=(/usr/include /usr/local/include) dir zlib=0 zstd=0
    if [[ "$os" == macos ]]; then
        # zlib comes with the macOS SDK; zstd from Homebrew or MacPorts.
        dirs+=("$(xcrun --show-sdk-path 2>/dev/null || echo /nonexistent)/usr/include" /opt/local/include)
        if [[ -n "$brew_prefix" ]]; then dirs+=("$brew_prefix/include"); fi
    fi
    for dir in "${dirs[@]}"; do
        [[ -f "$dir/zlib.h" ]] && zlib=1
        [[ -f "$dir/zstd.h" ]] && zstd=1
    done
    ((zlib && zstd))
}

webkit_present() {
    have pkg-config || return 1
    local module
    for module in webkit2gtk-4.1 webkitgtk-6.0 webkit2gtk-4.0; do
        pkg-config --exists "$module" 2>/dev/null && return 0
    done
    return 1
}

check_flywheel_deps() {
    step "Checking build tools"
    local missing=()
    if [[ "$os" == macos ]]; then
        command_line_tools_ok || install_command_line_tools
        brew_found || true
    fi
    have c++ || have g++ || have clang++ || missing+=(build)
    have make || have ninja || missing+=(build)
    have curl || have wget || missing+=(build)
    if have cmake; then
        local version
        version="$(cmake --version | head -n1 | awk '{print $3}')"
        version_ge "$version" "$CMAKE_MIN" || missing+=(build)
    else
        missing+=(build)
    fi
    if ((${#missing[@]})); then
        install_for build
    fi
    have cmake || ((dry_run)) || die "cmake was not installed"
    ok "compiler and CMake ($(cmake --version 2>/dev/null | head -n1 | awk '{print $3}'))"

    if ! find_llvm; then
        case "$distro" in
        debian) install_llvm_debian ;;
        macos)
            ((install_deps)) || die "LLVM $LLVM_MIN-$LLVM_MAX is required (e.g. brew install llvm@$LLVM_DEFAULT)"
            find_brew
            install_packages "$(brew_llvm_formula)"
            ;;
        *) install_for llvm ;;
        esac
        find_llvm || ((dry_run)) ||
            die "LLVM $LLVM_MIN-$LLVM_MAX development files were not found (your distribution may" \
                "package a different version; install one and rerun)"
    fi
    if [[ -n "$llvm_config" ]]; then ok "LLVM $("$llvm_config" --version) ($llvm_config)"; fi

    if ! compress_present; then
        install_for compress
        compress_present || ((dry_run)) || die "zlib and zstd development files were not found (install them and rerun)"
    fi
    ok "zlib and zstd"

    if [[ "$os" == macos ]]; then
        # The macOS desktop backend uses the system WebKit (WKWebView) through webview/webview,
        # which the build downloads; there is nothing to install.
        if [[ "$desktop" != OFF ]]; then ok "desktop windows (system WebKit)"; fi
    elif [[ "$desktop" != OFF ]]; then
        if webkit_present; then
            ok "GTK and WebKitGTK (desktop windows)"
        elif [[ "$desktop" == ON ]] ||
            ask "Install GTK and WebKitGTK for desktop windows (import desktop)?" n; then
            install_for desktop
        else
            info "desktop windows will not be available (rerun with --desktop on to add them)"
        fi
    fi
    return 0
}

install_flywheel() {
    local src build
    if [[ -n "$source_dir" ]]; then
        src="$source_dir"
        step "Building Flywheel from $src"
    else
        src="$work/flywheel"
        step "Downloading Flywheel ($ref)"
        download_source "$FLYWHEEL_REPO" "$src"
        step "Building Flywheel"
    fi
    build="$work/build"
    local llvm_dir=""
    [[ -n "$llvm_config" ]] && llvm_dir="$("$llvm_config" --cmakedir)"
    info "This takes a few minutes; the first build also downloads SQLite and Mbed TLS."
    # (Arrays are only expanded when non-empty: bash 3.2, macOS's /bin/bash, treats an empty
    # "${array[@]}" as unbound under set -u.)
    local configure=(cmake -S "$src" -B "$build")
    have ninja && configure+=(-G Ninja)
    configure+=(-DCMAKE_BUILD_TYPE=Release "-DLLVM_DIR=$llvm_dir" "-DFLYWHEEL_DESKTOP=$desktop" -Wno-dev)
    # LLVM's CMake files look for zstd, which Homebrew keeps outside CMake's default search path.
    if [[ -n "$brew_prefix" ]]; then configure+=("-DCMAKE_PREFIX_PATH=$brew_prefix"); fi
    printf '    %s$ %s%s\n' "$dim" "${configure[*]}" "$reset"
    if ((!dry_run)) && ! "${configure[@]}" >"$work/configure.log" 2>&1; then
        tail -n 30 "$work/configure.log" >&2
        die "configuring Flywheel failed (log above)"
    fi
    build_with_progress cmake --build "$build" --parallel "${jobs:-$(cpu_count)}"
    step "Installing Flywheel into $prefix"
    run cmake --install "$build" --prefix "$prefix" >/dev/null
    install_alias
    if ((!dry_run)); then
        "$prefix/bin/flywheel" --version >/dev/null || die "the installed compiler does not run"
        "$prefix/bin/fw" --version >/dev/null || die "the fw alias does not run"
        ok "$("$prefix/bin/flywheel" --version)"
    fi
}

# Runs the build, drawing a progress bar from Ninja's "[12/345]" or Make's "[ 45%]" status lines
# when the output is a terminal. The full output goes to a log, shown if the build fails.
build_with_progress() {
    printf '    %s$ %s%s\n' "$dim" "$*" "$reset" >&2
    if ((dry_run)); then return; fi
    if [[ ! -t 1 ]]; then
        "$@"
        return
    fi
    local log="$work/build.log"
    if ! "$@" 2>&1 | tee "$log" | awk -v width="$BAR_WIDTH" '
        {
            if (match($0, /^\[ *[0-9]+\/[0-9]+\]/)) {
                s = substr($0, RSTART + 1, RLENGTH - 2); gsub(/ /, "", s)
                split(s, part, "/"); done = part[1] + 0; total = part[2] + 0
            } else if (match($0, /^\[ *[0-9]+%\]/)) {
                s = substr($0, RSTART + 1, RLENGTH - 3); gsub(/ /, "", s)
                done = s + 0; total = 100
            } else next
            if (total <= 0) next
            filled = int(done * width / total); out = ""
            for (i = 0; i < width; i++) out = out (i < filled ? "#" : "-")
            printf "\r    [%s] %3d%%", out, int(done * 100 / total); fflush()
            shown = 1
        }
        END {
            # The last status line is not always N/N; the build finished, so show it full.
            if (shown) { out = ""; for (i = 0; i < width; i++) out = out "#"; printf "\r    [%s] 100%%\n", out }
        }'; then
        printf '\n' >&2
        tail -n 40 "$log" >&2
        die "building Flywheel failed (log above; full log: $log)"
    fi
}

# `fw` is a shorter name for `flywheel`: a symlink next to it, so it works in every shell and
# from scripts. Flywheel finds its runtime relative to the bin directory, which both share.
install_alias() {
    local alias="$prefix/bin/fw" existing
    run ln -sfn flywheel "$alias"
    existing="$(command -v fw 2>/dev/null || true)"
    if [[ -n "$existing" && "$existing" != "$alias" ]]; then
        warn "another fw is on PATH ($existing); it may shadow Flywheel's fw alias"
    fi
    ((dry_run)) || ok "fw -> flywheel"
}

# ---------------------------------------------------------------------------------------------
# PATH

shell_rc_files() {
    local shell_name
    shell_name="$(basename "${SHELL:-bash}")"
    echo "$HOME/.profile" # login shells, and the desktop session on most distributions
    case "$shell_name" in
    bash)
        echo "$HOME/.bashrc"
        # macOS terminals start login shells, which read .bash_profile instead of .profile.
        if [[ "$os" == macos ]]; then echo "$HOME/.bash_profile"; fi
        ;;
    zsh) echo "${ZDOTDIR:-$HOME}/.zshrc" ;;
    fish) echo "${XDG_CONFIG_HOME:-$HOME/.config}/fish/conf.d/flywheel.fish" ;;
    esac
}

remove_path_block() {
    local file="$1"
    [[ -f "$file" ]] && grep -qF "$PATH_MARK" "$file" || return 0
    if ((dry_run)); then
        info "would remove the Flywheel PATH lines from $file"
        return
    fi
    local tmp
    tmp="$(mktemp)"
    # Older installers could glue the start marker onto the last line of a file that had no
    # trailing newline; keep that line's own content and drop the marker.
    awk -v start="$PATH_MARK" -v end="$PATH_END" '
        !skip && (i = index($0, start)) > 1 && substr($0, i) == start {
            print substr($0, 1, i - 1); skip = 1; next
        }
        $0 == start { skip = 1; next }
        $0 == end { skip = 0; next }
        !skip' "$file" >"$tmp"
    cat "$tmp" >"$file"
    rm -f "$tmp"
}

add_to_path() {
    local bin="$prefix/bin" file line
    if ((!modify_path)); then
        return
    fi
    step "Adding $bin to PATH"
    while read -r file; do
        if [[ "$file" == *.fish ]]; then
            line="fish_add_path -g \"$bin\""
        else
            line="case \":\$PATH:\" in *\":$bin:\"*) ;; *) export PATH=\"$bin:\$PATH\" ;; esac"
        fi
        remove_path_block "$file"
        if ((dry_run)); then
            info "would add to $file: $line"
            continue
        fi
        mkdir -p "$(dirname "$file")"
        # A file without a trailing newline would glue the marker onto its last line.
        if [[ -s "$file" && -n "$(tail -c1 "$file")" ]]; then
            printf '\n' >>"$file"
        fi
        printf '%s\n%s\n%s\n' "$PATH_MARK" "$line" "$PATH_END" >>"$file"
        ok "$file"
    done < <(shell_rc_files)
}

# ---------------------------------------------------------------------------------------------
# Pulley

python_for_pulley() {
    local candidate
    for candidate in python3 python3.14 python3.13 python3.12 python; do
        have "$candidate" || continue
        if "$candidate" -c "import sys; sys.exit(sys.version_info < (${PYTHON_MIN/./, }))" 2>/dev/null; then
            command -v "$candidate"
            return 0
        fi
    done
    return 1
}

install_pulley() {
    step "Installing Pulley"
    local python
    if ! python="$(python_for_pulley)" || ! have pipx; then
        install_for pulley
    fi
    python="$(python_for_pulley)" || ((dry_run)) ||
        die "Pulley needs Python $PYTHON_MIN or later; install it and rerun with --pulley"
    have pipx || ((dry_run)) || die "pipx was not installed"
    local src="$work/pulley"
    if [[ -n "$pulley_source" ]]; then
        copy_source "$pulley_source" "$src"
    else
        download_source "$PULLEY_REPO" "$src"
    fi
    run pipx install --force --python "${python:-python3}" "$src"
    local pulley_bin
    pulley_bin="$(pipx environment --value PIPX_BIN_DIR 2>/dev/null || echo "$HOME/.local/bin")"
    if ((!dry_run)); then
        "$pulley_bin/pulley" config flywheel "$prefix/bin/flywheel" >/dev/null ||
            warn "could not point Pulley at $prefix/bin/flywheel; run: pulley config flywheel $prefix/bin/flywheel"
        ok "$("$pulley_bin/pulley" --version) (uses $prefix/bin/flywheel)"
    fi
    case ":$PATH:" in
    *":$pulley_bin:"*) ;;
    *) if ((modify_path)); then run pipx ensurepath >/dev/null; fi ;;
    esac
    return 0
}

# ---------------------------------------------------------------------------------------------
# VS Code extension

vscode_cli() {
    local candidate app
    for candidate in code code-insiders codium code-oss; do
        if have "$candidate"; then
            echo "$candidate"
            return 0
        fi
    done
    # On macOS the code command is only on PATH after "Shell Command: Install 'code' command";
    # it is always inside the app bundle.
    if [[ "$os" == macos ]]; then
        for app in "/Applications/Visual Studio Code.app" "$HOME/Applications/Visual Studio Code.app" \
            "/Applications/Visual Studio Code - Insiders.app" "/Applications/VSCodium.app"; do
            for candidate in "$app"/Contents/Resources/app/bin/{code,code-insiders,codium}; do
                if [[ -x "$candidate" ]]; then
                    echo "$candidate"
                    return 0
                fi
            done
        done
    fi
    return 1
}

node_ok() {
    have node && have npm &&
        (($(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0) >= NODE_MIN))
}

install_vscode() {
    step "Installing the VS Code extension"
    local code
    code="$(vscode_cli)" || die "VS Code's 'code' command was not found; install VS Code (and run" \
        "'Shell Command: Install code command in PATH' if needed), then rerun with --vscode"
    if ! node_ok; then
        install_for node
        node_ok || ((dry_run)) ||
            die "building the extension needs Node.js $NODE_MIN or later (your distribution's may" \
                "be older; see https://nodejs.org), then rerun with --vscode"
    fi
    local src="$work/vscode-flywheel"
    if [[ -n "$vscode_source" ]]; then
        copy_source "$vscode_source" "$src"
    else
        download_source "$VSCODE_REPO" "$src"
    fi
    (
        cd "$src" 2>/dev/null || ((dry_run))
        run npm ci --no-audit --no-fund --loglevel=error
        run npm run --silent package >/dev/null
    )
    run "$code" --install-extension "$src/flywheel-language.vsix" --force
    ok "$EXTENSION_ID in $code"
    return 0
}

# ---------------------------------------------------------------------------------------------
# Uninstall

do_uninstall() {
    step "Uninstalling Flywheel"
    if [[ -x "$prefix/bin/flywheel" ]]; then
        if [[ -d "$prefix/modules" ]] && [[ -n "$(ls -A "$prefix/modules" 2>/dev/null)" ]]; then
            warn "$prefix/modules holds globally installed packages; they are removed too"
        fi
        ask "Remove $prefix?" y || die "cancelled"
        run rm -rf "$prefix"
        ok "removed $prefix"
    else
        info "no Flywheel installation in $prefix (use --prefix to choose another)"
    fi
    local file
    while read -r file; do remove_path_block "$file"; done < <(
        shell_rc_files
        echo "$HOME/.bashrc"
        echo "$HOME/.bash_profile"
        echo "${ZDOTDIR:-$HOME}/.zshrc"
    )
    local fish="${XDG_CONFIG_HOME:-$HOME/.config}/fish/conf.d/flywheel.fish"
    if [[ -f "$fish" ]]; then run rm -f "$fish"; fi
    if have pipx && pipx list --short 2>/dev/null | grep -q '^fw-pulley '; then
        if ask "Uninstall Pulley too?" y; then run pipx uninstall fw-pulley; fi
    fi
    local code
    if code="$(vscode_cli)" && "$code" --list-extensions 2>/dev/null | grep -qix "$EXTENSION_ID"; then
        if ask "Uninstall the VS Code extension too?" y; then
            run "$code" --uninstall-extension "$EXTENSION_ID"
        fi
    fi
    printf '\n%sFlywheel has been uninstalled.%s Open a new terminal to refresh PATH.\n' "$green" "$reset"
}

# ---------------------------------------------------------------------------------------------

choose_components() {
    if [[ -z "$want_pulley" ]]; then
        if has_tty && ((!assume_yes)); then
            ask "Also install Pulley, the Flywheel package manager?" n && want_pulley=1 || want_pulley=0
        else
            want_pulley=0
        fi
    fi
    if [[ -z "$want_vscode" ]]; then
        if vscode_cli >/dev/null && has_tty && ((!assume_yes)); then
            ask "Also install the Flywheel extension for VS Code?" n && want_vscode=1 || want_vscode=0
        else
            want_vscode=0
        fi
    fi
}

main() {
    parse_args "$@"
    detect_platform
    if ((EUID == 0)) && [[ -z "${FLYWHEEL_PREFIX:-}" ]]; then
        warn "running as root installs Flywheel for root only; run as your own user instead"
    fi

    if ((uninstall)); then
        do_uninstall
        return
    fi

    printf '%sFlywheel installer%s\n' "$bold" "$reset"
    info "Flywheel:  $prefix  (${source_dir:-$FLYWHEEL_REPO @ $ref})"
    choose_components
    if ((want_pulley)); then info "Pulley:    pipx (fw-pulley)"; fi
    if ((want_vscode)); then info "VS Code:   $EXTENSION_ID"; fi
    if ((dry_run)); then info "${yellow}dry run: nothing will be changed${reset}"; fi

    # One step each: build tools, download (unless --source), build, install, PATH, extras.
    progress_total=$((3 + modify_path + want_pulley + want_vscode))
    if [[ -z "$source_dir" ]]; then progress_total=$((progress_total + 1)); fi
    make_workdir
    check_flywheel_deps
    install_flywheel
    add_to_path
    if ((want_pulley)); then install_pulley; fi
    if ((want_vscode)); then install_vscode; fi

    if ((dry_run)); then
        printf '\n%sDry run complete.%s Nothing was changed.\n' "$green" "$reset"
        return 0
    fi
    printf '\n%sFlywheel is installed.%s\n' "$green" "$reset"
    case ":$PATH:" in
    *":$prefix/bin:"*) info "Try: flywheel hello.fw  (or the short alias: fw hello.fw)" ;;
    *)
        if ((modify_path)); then
            info "Open a new terminal (or run: export PATH=\"$prefix/bin:\$PATH\"), then try:"
        else
            info "Add $prefix/bin to PATH, then try:"
        fi
        info "  echo 'print \"Hello, world!\"' > hello.fw && flywheel hello.fw"
        info "(fw is a short alias for flywheel: fw run hello.fw)"
        ;;
    esac
    if ((want_vscode)); then
        if [[ "$os" == macos ]]; then
            info "VS Code opened from the Dock or Finder does not read your shell's PATH; set"
        else
            info "VS Code started from your desktop picks up PATH after you log in again; or set"
        fi
        info "\"flywheel.path\": \"$prefix/bin/flywheel\" in its settings."
    fi
    return 0
}

main "$@"
