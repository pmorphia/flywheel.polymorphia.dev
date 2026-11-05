#!/usr/bin/env bash
# Flywheel Lite installer for Linux and macOS: builds and installs Flywheel Lite (flywheel-lite,
# with the short alias fwl), the bytecode VM that runs Flywheel programs without LLVM.
#
#   curl -fsSL https://flywheel.polymorphia.dev/lite-install.sh | bash
#   curl -fsSL https://flywheel.polymorphia.dev/lite-install.sh | bash -s -- --yes
#
# Run with --help for options. Flywheel Lite needs only a C compiler and make. Nothing is installed
# system-wide except those, from your package manager (listed and confirmed before sudo is used),
# or Apple's Command Line Tools on macOS.
#
# The whole script is inside functions and `main` runs on the last line, so a partially
# downloaded copy does nothing.

set -euo pipefail

LITE_REPO="${LITE_REPO:-https://github.com/fwlang/flywheel-lite}"
FLYWHEEL_REPO="${FLYWHEEL_REPO:-https://github.com/fwlang/flywheel}"
PATH_MARK="# >>> flywheel-lite >>>"
PATH_END="# <<< flywheel-lite <<<"

# ---------------------------------------------------------------------------------------------
# Options

prefix="${LITE_PREFIX:-$HOME/.local/flywheel-lite}"
ref="main"
flywheel_ref="main"
source_dir=""
flywheel_source=""
assume_yes=0
install_deps=1
modify_path=1
dry_run=0
uninstall=0
keep_build=0

usage() {
    cat <<EOF
Install Flywheel Lite (runs Flywheel programs on a bytecode VM) on Linux or macOS.

Usage: lite-install.sh [options]

Where and what
  --prefix DIR            install Flywheel Lite into DIR (default: ~/.local/flywheel-lite)
  --ref REF               Flywheel Lite branch, tag, or commit to build (default: main)
  --flywheel-ref REF      Flywheel branch, tag, or commit whose library modules are
                          embedded (default: main)
  --source DIR            build Flywheel Lite from a local checkout instead of downloading
  --flywheel-source DIR   take the library modules from a local Flywheel checkout
                          (default with --source: its parent directory, if it is one)

Behaviour
  -y, --yes               answer yes to every question (for scripts and CI)
  --no-deps               do not install packages; fail if something is missing
  --no-modify-path        do not add Flywheel Lite to PATH in your shell startup files
  --keep-build            keep the build directory (printed at the end)
  --dry-run               print what would be done without changing anything
  --uninstall             remove Flywheel Lite
  -h, --help              show this help

Environment
  LITE_PREFIX             same as --prefix
  CC                      C compiler to build with (default: cc)
  NO_COLOR                disable coloured output
EOF
}

parse_args() {
    while (($#)); do
        case "$1" in
        --prefix) prefix="${2:?--prefix needs a directory}"; shift ;;
        --prefix=*) prefix="${1#*=}" ;;
        --ref) ref="${2:?--ref needs a branch, tag, or commit}"; shift ;;
        --ref=*) ref="${1#*=}" ;;
        --flywheel-ref) flywheel_ref="${2:?--flywheel-ref needs a branch, tag, or commit}"; shift ;;
        --flywheel-ref=*) flywheel_ref="${1#*=}" ;;
        --source) source_dir="${2:?--source needs a directory}"; shift ;;
        --source=*) source_dir="${1#*=}" ;;
        --flywheel-source) flywheel_source="${2:?--flywheel-source needs a directory}"; shift ;;
        --flywheel-source=*) flywheel_source="${1#*=}" ;;
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
    prefix="${prefix/#\~/$HOME}"
    [[ "$prefix" = /* ]] || prefix="$PWD/$prefix"
    if [[ -n "$source_dir" ]]; then
        source_dir="$(cd "$source_dir" && pwd)" || die "--source: no such directory"
        [[ -f "$source_dir/Makefile" && -f "$source_dir/tools/embed.c" ]] ||
            die "--source: $source_dir is not a Flywheel Lite checkout"
        # Flywheel Lite is normally cloned inside a Flywheel checkout.
        if [[ -z "$flywheel_source" && -d "$source_dir/../stdlib/fw" ]]; then
            flywheel_source="$source_dir/.."
        fi
    fi
    if [[ -n "$flywheel_source" ]]; then
        flywheel_source="$(cd "$flywheel_source" && pwd)" || die "--flywheel-source: no such directory"
        [[ -d "$flywheel_source/stdlib/fw" ]] || die "--flywheel-source: $flywheel_source is not a Flywheel checkout"
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
# advances the bar. The same bar is drawn by lite-install.ps1.
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

# ---------------------------------------------------------------------------------------------
# Platform and packages

os=""
distro=""
detect_platform() {
    case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=macos; distro=macos; return ;;
    *) die "this installer is for Linux and macOS; on Windows use lite-install.ps1" ;;
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

# The packages that provide a C compiler, make, curl, and tar.
build_packages() {
    case "$distro" in
    arch) echo "base-devel curl tar" ;;
    debian) echo "build-essential curl ca-certificates tar" ;;
    fedora) echo "gcc make curl tar gzip" ;;
    esac
}

apt_updated=0
install_packages() {
    local packages=("$@")
    if ((!install_deps)); then
        die "missing packages: ${packages[*]} (install them, or rerun without --no-deps)"
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

# On macOS cc and make come with Apple's Command Line Tools. Their installer is a GUI dialog
# that runs on its own, so this starts it and asks you to rerun once it has finished.
install_command_line_tools() {
    if ((!install_deps)); then
        die "a C compiler and make are required (install Apple's Command Line Tools: xcode-select --install)"
    fi
    info "Flywheel Lite needs a C compiler and make, which come with Apple's Command Line Tools."
    ask "Open the Command Line Tools installer now?" y ||
        die "a C compiler is required (install it with: xcode-select --install)"
    run xcode-select --install || true
    ((dry_run)) || die "finish the Command Line Tools installation in the window that opened, then rerun this installer"
}

cc_cmd() { echo "${CC:-cc}"; }

# A compiler that actually works: on macOS /usr/bin/cc exists even without the Command Line
# Tools, as a stub that only offers to install them.
compiler_ok() {
    local cc
    cc="$(cc_cmd)"
    have "$cc" || return 1
    if [[ "$os" == macos ]]; then xcode-select -p >/dev/null 2>&1 || return 1; fi
    "$cc" --version >/dev/null 2>&1
}

check_deps() {
    step "Checking build tools"
    local missing=0
    compiler_ok || missing=1
    have make || missing=1
    have curl || have wget || missing=1
    have tar || missing=1
    if ((missing)); then
        if [[ "$os" == macos ]]; then
            install_command_line_tools
        else
            local packages
            packages="$(build_packages)"
            [[ -n "$packages" ]] ||
                die "this installer does not know your distribution's packages; please install a C" \
                    "compiler (gcc or clang), make, curl, and tar, then rerun"
            # shellcheck disable=SC2086
            install_packages $packages
        fi
    fi
    if ! ((dry_run)); then
        compiler_ok || die "no working C compiler ('$(cc_cmd)'); install gcc or clang, or set CC, and rerun"
        have make || die "make was not installed"
    fi
    ok "C compiler ($( ("$(cc_cmd)" --version 2>/dev/null || echo "$(cc_cmd)") | head -n1)) and make"
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
    work="$(mktemp -d "${TMPDIR:-/tmp}/lite-install.XXXXXX")"
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

# download_source REPO REF DIR: the tree of REF from a GitHub repository.
download_source() {
    local repo="$1" at="$2" dir="$3" archive="$3.tar.gz"
    fetch "$repo/archive/$at.tar.gz" "$archive" ||
        die "cannot download $repo at '$at' (is the branch, tag, or commit right?)"
    run mkdir -p "$dir"
    # GitHub answers with an HTML page, not an error, for an empty repository.
    if ((!dry_run)) && ! gzip -t "$archive" 2>/dev/null; then
        die "$repo has no '$at' to download (the repository may be empty or private)"
    fi
    run tar -xzf "$archive" -C "$dir" --strip-components=1
    run rm -f "$archive"
}

# ---------------------------------------------------------------------------------------------
# Flywheel Lite

install_lite() {
    local src flywheel
    if [[ -n "$source_dir" ]]; then
        src="$source_dir"
    else
        src="$work/flywheel-lite"
    fi
    if [[ -n "$flywheel_source" ]]; then
        flywheel="$flywheel_source"
    else
        flywheel="$work/flywheel"
    fi
    if [[ -z "$source_dir" || -z "$flywheel_source" ]]; then
        step "Downloading Flywheel Lite"
        if [[ -z "$source_dir" ]]; then download_source "$LITE_REPO" "$ref" "$src"; fi
        # The library modules written in Flywheel (csv, url, ...) are embedded at build time.
        if [[ -z "$flywheel_source" ]]; then download_source "$FLYWHEEL_REPO" "$flywheel_ref" "$flywheel"; fi
    fi

    step "Building Flywheel Lite"
    # BUILD points outside the source tree, so a local checkout is left untouched.
    local build="$work/build"
    local make_args=(-C "$src" "BUILD=$build" "FLYWHEEL_DIR=$flywheel" "CC=$(cc_cmd)")
    printf '    %s$ make %s%s\n' "$dim" "${make_args[*]}" "$reset"
    if ((!dry_run)) && ! make "${make_args[@]}" >"$work/build.log" 2>&1; then
        tail -n 40 "$work/build.log" >&2
        die "building Flywheel Lite failed (log above)"
    fi
    ((dry_run)) || ok "built $build/flywheel-lite"

    step "Installing Flywheel Lite into $prefix"
    run mkdir -p "$prefix/bin"
    # Copy to a temporary name and rename, so a running flywheel-lite is never overwritten in place.
    run cp "$build/flywheel-lite" "$prefix/bin/flywheel-lite.new"
    run chmod 755 "$prefix/bin/flywheel-lite.new"
    run mv -f "$prefix/bin/flywheel-lite.new" "$prefix/bin/flywheel-lite"
    # fwl is a shorter name for flywheel-lite: a symlink next to it, so it works in every shell
    # and from scripts.
    run ln -sfn flywheel-lite "$prefix/bin/fwl"
    if ((!dry_run)); then
        local version out
        version="$("$prefix/bin/flywheel-lite" --version)" || die "the installed flywheel-lite does not run"
        out="$("$prefix/bin/flywheel-lite" -s 'print 6 * 7' 2>&1)" || die "the installed flywheel-lite cannot run a program: $out"
        [[ "$out" == 42 ]] || die "the installed flywheel-lite printed '$out' for 'print 6 * 7' instead of 42"
        "$prefix/bin/fwl" --version >/dev/null || die "the fwl alias does not run"
        ok "$version"
        ok "fwl -> flywheel-lite"
    fi
    local existing name
    for name in flywheel-lite fwl; do
        existing="$(command -v "$name" 2>/dev/null || true)"
        if [[ -n "$existing" && "$existing" != "$prefix/bin/$name" ]]; then
            warn "another $name is on PATH ($existing); it may shadow this one"
        fi
    done
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
    fish) echo "${XDG_CONFIG_HOME:-$HOME/.config}/fish/conf.d/flywheel-lite.fish" ;;
    esac
}

remove_path_block() {
    local file="$1"
    [[ -f "$file" ]] && grep -qF "$PATH_MARK" "$file" || return 0
    if ((dry_run)); then
        info "would remove the Flywheel Lite PATH lines from $file"
        return
    fi
    local tmp
    tmp="$(mktemp)"
    awk -v start="$PATH_MARK" -v end="$PATH_END" '
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
# Uninstall

do_uninstall() {
    step "Uninstalling Flywheel Lite"
    if [[ -x "$prefix/bin/flywheel-lite" ]]; then
        ask "Remove $prefix?" y || die "cancelled"
        run rm -rf "$prefix"
        ok "removed $prefix"
    else
        info "no Flywheel Lite installation in $prefix (use --prefix to choose another)"
    fi
    local file
    while read -r file; do remove_path_block "$file"; done < <(
        shell_rc_files
        echo "$HOME/.bashrc"
        echo "$HOME/.bash_profile"
        echo "${ZDOTDIR:-$HOME}/.zshrc"
    )
    local fish="${XDG_CONFIG_HOME:-$HOME/.config}/fish/conf.d/flywheel-lite.fish"
    if [[ -f "$fish" ]]; then run rm -f "$fish"; fi
    printf '\n%sFlywheel Lite has been uninstalled.%s Open a new terminal to refresh PATH.\n' "$green" "$reset"
}

# ---------------------------------------------------------------------------------------------

main() {
    parse_args "$@"
    detect_platform
    if ((EUID == 0)) && [[ -z "${LITE_PREFIX:-}" ]]; then
        warn "running as root installs Flywheel Lite for root only; run as your own user instead"
    fi

    if ((uninstall)); then
        do_uninstall
        return
    fi

    printf '%sFlywheel Lite installer%s\n' "$bold" "$reset"
    info "Lite:      $prefix  (${source_dir:-$LITE_REPO @ $ref})"
    info "Library:   ${flywheel_source:-$FLYWHEEL_REPO @ $flywheel_ref}"
    if ((dry_run)); then info "${yellow}dry run: nothing will be changed${reset}"; fi

    # One step each: build tools, download (unless both are local), build, install, PATH.
    progress_total=$((3 + modify_path))
    if [[ -z "$source_dir" || -z "$flywheel_source" ]]; then progress_total=$((progress_total + 1)); fi
    make_workdir
    check_deps
    install_lite
    add_to_path

    if ((dry_run)); then
        printf '\n%sDry run complete.%s Nothing was changed.\n' "$green" "$reset"
        return 0
    fi
    printf '\n%sFlywheel Lite is installed.%s\n' "$green" "$reset"
    case ":$PATH:" in
    *":$prefix/bin:"*) info "Try: flywheel-lite hello.fw  (or the short alias: fwl hello.fw)" ;;
    *)
        if ((modify_path)); then
            info "Open a new terminal (or run: export PATH=\"$prefix/bin:\$PATH\"), then try:"
        else
            info "Add $prefix/bin to PATH, then try:"
        fi
        info "  echo 'print \"Hello, world!\"' > hello.fw && flywheel-lite hello.fw"
        info "(fwl is a short alias for flywheel-lite: fwl hello.fw)"
        ;;
    esac
}

main "$@"
