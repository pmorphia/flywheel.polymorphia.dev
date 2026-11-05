<#
.SYNOPSIS
    Turbine installer for Windows: builds and installs Turbine, the bytecode VM that runs
    Flywheel programs without LLVM.

.DESCRIPTION
    Run from PowerShell (no administrator rights needed):

        irm https://flywheel.polymorphia.dev/turbine-install.ps1 | iex

    With options:

        & ([scriptblock]::Create((irm https://flywheel.polymorphia.dev/turbine-install.ps1))) -Yes

    What it sets up:
      - A C compiler: the Visual Studio C++ tools if installed, otherwise MinGW gcc if it is on
        PATH, otherwise Visual Studio 2022 Build Tools through winget (after asking; Windows
        shows its own elevation prompt).
      - Turbine in %LOCALAPPDATA%\Programs\Turbine, added to your user PATH.

    Turbine needs nothing else: no LLVM, no CMake, and nothing at run time.

.EXAMPLE
    .\turbine-install.ps1 -Yes
.EXAMPLE
    .\turbine-install.ps1 -Ref v0.1.0 -Prefix D:\Tools\Turbine
.EXAMPLE
    .\turbine-install.ps1 -Uninstall
#>
[CmdletBinding()]
param(
    # Installation directory.
    [string]$Prefix = $(if ($env:TURBINE_PREFIX) { $env:TURBINE_PREFIX } else { Join-Path $env:LOCALAPPDATA 'Programs\Turbine' }),
    # Turbine branch, tag, or commit to build.
    [string]$Ref = 'main',
    # Flywheel branch, tag, or commit whose library modules are embedded.
    [string]$FlywheelRef = 'main',
    # Build Turbine from a local checkout instead of downloading.
    [string]$Source,
    # Take the library modules from a local Flywheel checkout (default with -Source: its parent).
    [string]$FlywheelSource,
    # C compiler to build with.
    [ValidateSet('Auto', 'MSVC', 'GCC')]
    [string]$Compiler = 'Auto',
    # Answer yes to every question.
    [switch]$Yes,
    # Do not install tools; fail if something is missing.
    [switch]$NoDeps,
    # Do not add Turbine to the user PATH.
    [switch]$NoModifyPath,
    # Keep the build directory.
    [switch]$KeepBuild,
    # Print what would be done without changing anything.
    [switch]$DryRun,
    # Remove Turbine.
    [switch]$Uninstall,
    # Show help.
    [switch]$Help
)

# Everything below runs in a child scope, so `irm | iex` leaves no functions, variables, or
# preference changes behind in your session. The script is parsed completely before anything
# runs, so a partially downloaded copy does nothing.
& {

$TurbineRepo = 'https://github.com/fwlang/turbine'
$FlywheelRepo = 'https://github.com/fwlang/flywheel'
# Used when CMakeLists.txt does not list them (it is the source of truth).
$DefaultModules = @('csv', 'url', 'log', 'args', 'bigint', 'decimal')
# Nested calls from native code into the VM use the C stack; Windows defaults to 1 MB.
$StackSize = 16777216

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is far slower with a progress bar
Set-StrictMode -Version 2.0

# --- Output and prompts ------------------------------------------------------------------------

# Overall progress: Main sets Total to the number of steps it will run; each step advances the
# bar. The same bar is drawn by turbine-install.sh.
$Progress = @{ Done = 0; Total = 0 }
$BarWidth = 24

# "[##########--------------]" for Done of Total.
function Format-Bar([int]$Done, [int]$Total) {
    $filled = [math]::Floor($Done * $BarWidth / $Total)
    return '[' + ('#' * $filled) + ('-' * ($BarWidth - $filled)) + ']'
}

function Write-Step([string]$Text) {
    Write-Host ''
    Write-Host '==> ' -ForegroundColor Blue -NoNewline
    if ($Progress.Total -gt 0) {
        $Progress.Done++
        if ($Progress.Done -gt $Progress.Total) { $Progress.Total = $Progress.Done }
        Write-Host "$(Format-Bar $Progress.Done $Progress.Total) $($Progress.Done)/$($Progress.Total)  " -ForegroundColor DarkGray -NoNewline
    }
    Write-Host $Text -ForegroundColor White
}
function Write-Info([string]$Text) { Write-Host "    $Text" }
function Write-Ok([string]$Text) { Write-Host '    ' -NoNewline; Write-Host 'OK ' -ForegroundColor Green -NoNewline; Write-Host $Text }
function Write-Warn([string]$Text) { Write-Host 'warning: ' -ForegroundColor Yellow -NoNewline; Write-Host $Text }

$ErrorMarker = 'turbine-install: '
function Stop-Install([string]$Text) { throw "$ErrorMarker$Text" }

function Test-Interactive {
    return [Environment]::UserInteractive -and -not [Console]::IsInputRedirected
}

# Ask "question" $true/$false (the default). Returns $true for yes.
function Confirm-Step([string]$Question, [bool]$Default) {
    if ($Yes) { return $true }
    if (-not (Test-Interactive)) { return $Default }
    $hint = if ($Default) { '[Y/n]' } else { '[y/N]' }
    Write-Host '? ' -ForegroundColor Yellow -NoNewline
    $answer = Read-Host "$Question $hint"
    if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
    return $answer -match '^[Yy]'
}

# Runs a native command (or prints it with -DryRun) and fails on a non-zero exit code.
function Invoke-Native {
    param([Parameter(Mandatory)][string]$Command, [string[]]$Arguments = @(), [switch]$Quiet)
    Write-Host "    `$ $Command $($Arguments -join ' ')" -ForegroundColor DarkGray
    if ($DryRun) { return }
    $ErrorActionPreference = 'Continue' # see Invoke-Probe
    if ($Quiet) {
        $output = & $Command @Arguments 2>&1
        if ($LASTEXITCODE -ne 0) { $output | Select-Object -Last 30 | ForEach-Object { Write-Host $_ } }
    } else {
        # To the console, not the pipeline, so it never becomes part of a function's result.
        & $Command @Arguments | Out-Host
    }
    if ($LASTEXITCODE -ne 0) { Stop-Install "'$Command' failed with exit code $LASTEXITCODE" }
}

# Runs native commands whose stderr is redirected. Windows PowerShell 5.1 turns redirected
# stderr into errors, which 'Stop' would make fatal; exit codes are checked instead.
function Invoke-Probe([scriptblock]$Block) {
    $ErrorActionPreference = 'Continue'
    & $Block
}

function Test-Command([string]$Name) { return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

# --- Downloads ---------------------------------------------------------------------------------

function New-WorkDirectory {
    $path = Join-Path ([IO.Path]::GetTempPath()) ("turbine-install-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $path | Out-Null
    return $path
}

function Remove-WorkDirectory([string]$Path) {
    if ($Path -and (Test-Path $Path)) {
        if ($KeepBuild) { Write-Info "build files kept in $Path" }
        else { Remove-Item -Recurse -Force $Path -ErrorAction SilentlyContinue }
    }
}

# The installer loads the Visual Studio environment; under `irm | iex` that would otherwise stay
# in your session.
function Save-Environment {
    $saved = @{}
    foreach ($item in Get-ChildItem env:) { $saved[$item.Name] = $item.Value }
    return $saved
}

function Restore-Environment([hashtable]$Saved) {
    foreach ($item in @(Get-ChildItem env:)) {
        if (-not $Saved.ContainsKey($item.Name)) {
            try { [Environment]::SetEnvironmentVariable($item.Name, $null, 'Process') } catch { }
        }
    }
    foreach ($name in $Saved.Keys) {
        try { [Environment]::SetEnvironmentVariable($name, $Saved[$name], 'Process') } catch { }
    }
}

function Get-File([string]$Url, [string]$Path) {
    Write-Host "    `$ download $Url" -ForegroundColor DarkGray
    if ($DryRun) { return }
    Invoke-WebRequest -Uri $Url -OutFile $Path -UseBasicParsing
}

# The tree of $At from a GitHub repository, extracted into $Directory.
function Get-Source([string]$Repo, [string]$At, [string]$Directory) {
    $zip = "$Directory.zip"
    try { Get-File "$Repo/archive/$At.zip" $zip }
    catch { Stop-Install "cannot download $Repo at '$At' (is the branch, tag, or commit right?)" }
    if ($DryRun) { return }
    # GitHub answers with an HTML page, not an error, for an empty repository.
    $stream = [IO.File]::OpenRead($zip)
    try { $first = $stream.ReadByte(); $second = $stream.ReadByte() } finally { $stream.Dispose() }
    if ($first -ne 0x50 -or $second -ne 0x4B) {
        Stop-Install "$Repo has no '$At' to download (the repository may be empty or private)"
    }
    $unpacked = "$Directory.unpacked"
    Expand-Archive -Path $zip -DestinationPath $unpacked -Force
    $root = Get-ChildItem -Path $unpacked -Directory | Select-Object -First 1
    Move-Item -Path $root.FullName -Destination $Directory
    Remove-Item -Recurse -Force $unpacked, $zip
}

function Resolve-Checkout([string]$Path, [string]$Marker, [string]$Option) {
    if (-not $Path) { return $null }
    $full = (Resolve-Path -Path $Path -ErrorAction SilentlyContinue)
    if (-not $full -or -not (Test-Path (Join-Path $full $Marker))) { Stop-Install "${Option}: $Path is not the expected checkout" }
    return $full.Path
}

# --- Compiler ----------------------------------------------------------------------------------

function Find-VisualStudio {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path $vswhere)) { return $null }
    $path = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($path -and (Test-Path (Join-Path $path 'Common7\Tools\VsDevCmd.bat'))) { return $path }
    return $null
}

function Install-VisualStudio {
    if ($NoDeps) { Stop-Install 'a C compiler is required: Visual Studio 2022 with the C++ workload, or MinGW gcc on PATH (rerun without -NoDeps to install Visual Studio)' }
    if (-not (Test-Command winget)) {
        Stop-Install 'install "Build Tools for Visual Studio 2022" with "Desktop development with C++" from https://visualstudio.microsoft.com/downloads/ (or put MinGW gcc on PATH), then rerun'
    }
    Write-Info 'No C compiler was found. The free "Build Tools for Visual Studio 2022" with the C++'
    Write-Info 'workload will be installed (several GB; Windows asks for permission).'
    Write-Info 'If you already have MinGW gcc, cancel, put it on PATH, and rerun instead.'
    if (-not (Confirm-Step 'Install Visual Studio Build Tools now?' $true)) { Stop-Install 'a C compiler is required' }
    Invoke-Native winget @('install', '--id', 'Microsoft.VisualStudio.2022.BuildTools', '--exact', '--source', 'winget',
        '--accept-package-agreements', '--accept-source-agreements',
        '--override', '--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended')
}

# Loads the x64 developer environment (cl, link, INCLUDE, LIB, ...) into this session.
function Enter-DeveloperShell([string]$VisualStudio) {
    $devcmd = Join-Path $VisualStudio 'Common7\Tools\VsDevCmd.bat'
    $lines = Invoke-Probe { & cmd.exe /d /s /c "`"$devcmd`" -arch=amd64 -host_arch=amd64 -no_logo && set" }
    if ($LASTEXITCODE -ne 0) { Stop-Install "cannot load the Visual Studio environment ($devcmd)" }
    foreach ($line in $lines) {
        $index = $line.IndexOf('=')
        if ($index -gt 0) { [Environment]::SetEnvironmentVariable($line.Substring(0, $index), $line.Substring($index + 1), 'Process') }
    }
}

# Picks the compiler and prepares its environment. Returns 'MSVC' or 'GCC'.
function Install-BuildTools {
    Write-Step 'Checking build tools'
    $vs = if ($Compiler -ne 'GCC') { Find-VisualStudio } else { $null }
    if (-not $vs -and $Compiler -ne 'MSVC' -and (Test-Command gcc)) {
        $version = Invoke-Probe { & gcc --version 2>$null } | Select-Object -First 1
        Write-Ok "gcc ($version)"
        return 'GCC'
    }
    if ($Compiler -eq 'GCC') { Stop-Install '-Compiler GCC: gcc was not found on PATH' }
    if (-not $vs) {
        Install-VisualStudio
        $vs = Find-VisualStudio
        if (-not $vs -and -not $DryRun) { Stop-Install 'Visual Studio C++ tools are still not found; finish the installation and rerun' }
    }
    if ($vs) {
        Write-Ok "Visual Studio C++ tools ($vs)"
        Enter-DeveloperShell $vs
        if (-not (Test-Command cl) -and -not $DryRun) { Stop-Install 'cl.exe is not available after loading the Visual Studio environment' }
    }
    return 'MSVC'
}

# --- Turbine -----------------------------------------------------------------------------------

# The library modules to embed, as CMakeLists.txt lists them.
function Get-LibraryModules([string]$Src) {
    $cmake = Join-Path $Src 'CMakeLists.txt'
    if (-not $DryRun -and (Test-Path $cmake)) {
        $match = Select-String -Path $cmake -Pattern '^\s*set\(TURBINE_LIBRARY_MODULES\s+([^)]+)\)' | Select-Object -First 1
        if ($match) { return @($match.Matches[0].Groups[1].Value.Trim() -split '\s+') }
    }
    return $DefaultModules
}

function Install-Turbine([string]$Toolchain) {
    $src = if ($Source) { $Source } else { Join-Path $Work 'turbine' }
    $flywheel = if ($FlywheelSource) { $FlywheelSource } else { Join-Path $Work 'flywheel' }
    if (-not $Source -or -not $FlywheelSource) {
        Write-Step 'Downloading Turbine'
        if (-not $Source) { Get-Source $TurbineRepo $Ref $src }
        # The library modules written in Flywheel (csv, url, ...) are embedded at build time.
        if (-not $FlywheelSource) { Get-Source $FlywheelRepo $FlywheelRef $flywheel }
    }

    Write-Step 'Building Turbine'
    # The build directory is outside the source tree, so a local checkout is left untouched.
    $build = Join-Path $Work 'build'
    $objects = Join-Path $build 'obj'
    if (-not $DryRun) { New-Item -ItemType Directory -Path $objects -Force | Out-Null }
    $embed = Join-Path $build 'embed.exe'
    $embedded = Join-Path $build 'stdlib_embed.c'
    $exe = Join-Path $build 'turbine.exe'
    $stdlib = Join-Path $flywheel 'stdlib\fw'
    $modules = @(Get-LibraryModules $src | ForEach-Object { "$_=$(Join-Path $stdlib "$_.fw")" })
    $sources = if ($DryRun) { @((Join-Path $src 'src\*.c')) } else { @(Get-ChildItem (Join-Path $src 'src') -Filter '*.c' | ForEach-Object { $_.FullName }) }
    $sources += $embedded
    $embedSource = Join-Path $src 'tools\embed.c'

    if ($Toolchain -eq 'MSVC') {
        # cl writes its object files to the current directory: run it from the build tree (an
        # explicit /Fo:dir\ breaks when Windows PowerShell quotes a path with spaces).
        Push-Location -Path $(if ($DryRun) { $PWD } else { $objects })
        try {
            # /MT links the C runtime statically, so turbine.exe needs no Visual C++ redistributable.
            Invoke-Native cl @('/nologo', '/O1', '/MT', '/D_CRT_SECURE_NO_WARNINGS', "/Fe:$embed", $embedSource) -Quiet
            Invoke-Native $embed (@($embedded) + $modules)
            Invoke-Native cl (@('/nologo', '/std:c11', '/O2', '/MT', '/W3', '/utf-8', '/DNDEBUG', '/D_CRT_SECURE_NO_WARNINGS',
                "/I$(Join-Path $src 'src')", "/Fe:$exe") + $sources + @('/link', "/STACK:$StackSize")) -Quiet
        } finally { Pop-Location }
    } else {
        Invoke-Native gcc @('-O1', '-o', $embed, $embedSource) -Quiet
        Invoke-Native $embed (@($embedded) + $modules)
        Invoke-Native gcc (@('-std=c11', '-O2', '-Wall', '-Wextra', '-Wno-unused-parameter', "-I$(Join-Path $src 'src')",
            '-o', $exe) + $sources + @('-lm', '-static', "-Wl,--stack,$StackSize")) -Quiet
    }
    if (-not $DryRun) { Write-Ok "built $exe" }

    Write-Step "Installing Turbine into $Prefix"
    $bin = Join-Path $Prefix 'bin'
    $target = Join-Path $bin 'turbine.exe'
    Write-Host "    `$ copy $exe $target" -ForegroundColor DarkGray
    if ($DryRun) { return }
    New-Item -ItemType Directory -Path $bin -Force | Out-Null
    # A running turbine.exe cannot be overwritten, but it can be renamed out of the way.
    if (Test-Path $target) {
        $old = "$target.old"
        Remove-Item $old -Force -ErrorAction SilentlyContinue
        try { Move-Item $target $old -Force } catch { Stop-Install "cannot replace $target (is turbine running?)" }
        Remove-Item $old -Force -ErrorAction SilentlyContinue
    }
    Copy-Item $exe $target -Force

    $version = Invoke-Probe { & $target --version 2>&1 }
    if ($LASTEXITCODE -ne 0) { Stop-Install 'the installed turbine does not run' }
    $output = "$(Invoke-Probe { & $target -s 'print 6 * 7' 2>&1 })".Trim()
    if ($LASTEXITCODE -ne 0 -or $output -ne '42') { Stop-Install "the installed turbine printed '$output' for 'print 6 * 7' instead of 42" }
    Write-Ok "$version"
    $existing = Get-Command turbine -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existing -and $existing.Source -ine $target) { Write-Warn "another turbine is on PATH ($($existing.Source)); it may shadow this one" }
}

# --- PATH --------------------------------------------------------------------------------------

function Get-UserPathEntries {
    $path = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $path) { return @() }
    return @($path -split ';' | Where-Object { $_ })
}

function Set-UserPathEntries([string[]]$Entries) {
    if ($DryRun) { Write-Info "would set the user PATH to: $($Entries -join ';')"; return }
    [Environment]::SetEnvironmentVariable('Path', ($Entries -join ';'), 'User')
}

function Add-ToPath {
    if ($NoModifyPath) { return }
    $bin = Join-Path $Prefix 'bin'
    Write-Step "Adding $bin to your PATH"
    $entries = Get-UserPathEntries
    if ($entries | Where-Object { $_.TrimEnd('\') -ieq $bin }) { Write-Ok 'already on PATH'; return }
    Set-UserPathEntries (@($bin) + $entries)
    Write-Ok 'user PATH updated (new terminals pick it up)'
}

function Remove-FromPath {
    $bin = Join-Path $Prefix 'bin'
    $entries = Get-UserPathEntries
    $kept = @($entries | Where-Object { $_.TrimEnd('\') -ine $bin })
    if ($kept.Count -ne $entries.Count) { Set-UserPathEntries $kept; Write-Ok "removed $bin from PATH" }
}

# --- Uninstall ---------------------------------------------------------------------------------

function Invoke-Uninstall {
    Write-Step 'Uninstalling Turbine'
    if (Test-Path (Join-Path $Prefix 'bin\turbine.exe')) {
        if (-not (Confirm-Step "Remove $Prefix?" $true)) { Stop-Install 'cancelled' }
        if (-not $DryRun) { Remove-Item -Recurse -Force $Prefix }
        Write-Ok "removed $Prefix"
    } else {
        Write-Info "no Turbine installation in $Prefix (use -Prefix to choose another)"
    }
    Remove-FromPath
    Write-Info 'Visual Studio Build Tools (if installed) were left installed.'
    Write-Host ''
    Write-Host 'Turbine has been uninstalled.' -ForegroundColor Green
}

# --- Main --------------------------------------------------------------------------------------

function Show-Usage {
    @'
Install Turbine (runs Flywheel programs on a bytecode VM) on Windows.

  irm https://flywheel.polymorphia.dev/turbine-install.ps1 | iex
  & ([scriptblock]::Create((irm https://flywheel.polymorphia.dev/turbine-install.ps1))) -Yes
  .\turbine-install.ps1 [options]

Where and what
  -Prefix DIR          install directory (default: %LOCALAPPDATA%\Programs\Turbine)
  -Ref REF             Turbine branch, tag, or commit to build (default: main)
  -FlywheelRef REF     Flywheel branch, tag, or commit whose library modules are embedded
  -Source DIR          build Turbine from a local checkout
  -FlywheelSource DIR  take the library modules from a local Flywheel checkout
                       (default with -Source: its parent directory, if it is one)
  -Compiler NAME       Auto (default: Visual Studio, else gcc on PATH), MSVC, or GCC

Behaviour
  -Yes                 answer yes to every question
  -NoDeps              do not install tools; fail if something is missing
  -NoModifyPath        do not add Turbine to the user PATH
  -KeepBuild           keep the build directory
  -DryRun              print what would be done without changing anything
  -Uninstall           remove Turbine
  -Help                show this help
'@ | Write-Host
}

function Main {
    if ($Help) { Show-Usage; return }
    if ($env:OS -ne 'Windows_NT') { Stop-Install 'this installer is for Windows; on Linux and macOS use turbine-install.sh' }
    # Windows PowerShell 5.1 does not enable TLS 1.2 by default.
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    # Locals here are visible to every function Main calls.
    $Prefix = [IO.Path]::GetFullPath($Prefix)
    $Source = Resolve-Checkout $Source 'tools\embed.c' '-Source'
    # Turbine is normally cloned inside a Flywheel checkout.
    if ($Source -and -not $FlywheelSource -and (Test-Path (Join-Path $Source '..\stdlib\fw'))) {
        $FlywheelSource = [IO.Path]::GetFullPath((Join-Path $Source '..'))
    }
    $FlywheelSource = Resolve-Checkout $FlywheelSource 'stdlib\fw' '-FlywheelSource'

    if ($Uninstall) { Invoke-Uninstall; return }

    Write-Host 'Turbine installer' -ForegroundColor White
    $origin = if ($Source) { $Source } else { "$TurbineRepo @ $Ref" }
    $library = if ($FlywheelSource) { $FlywheelSource } else { "$FlywheelRepo @ $FlywheelRef" }
    Write-Info "Turbine:   $Prefix  ($origin)"
    Write-Info "Library:   $library"
    if ($DryRun) { Write-Info 'dry run: nothing will be changed' }

    # One step each: build tools, download (unless both are local), build, install, PATH.
    $Progress.Total = 3 + [int](-not ($Source -and $FlywheelSource)) + [int](-not $NoModifyPath)
    $Work = New-WorkDirectory
    $environment = Save-Environment
    try {
        $toolchain = Install-BuildTools
        Install-Turbine $toolchain
        Add-ToPath
    } finally {
        Restore-Environment $environment
        Remove-WorkDirectory $Work
    }
    # Turbine works in this session too, not only in new terminals.
    if (-not $NoModifyPath -and -not $DryRun) { $env:Path = "$(Join-Path $Prefix 'bin');$env:Path" }

    Write-Host ''
    if ($DryRun) { Write-Host 'Dry run complete. Nothing was changed.' -ForegroundColor Green; return }
    Write-Host 'Turbine is installed.' -ForegroundColor Green
    Write-Info 'Try:'
    Write-Info "  'print `"Hello, world!`"' | Set-Content hello.fw; turbine hello.fw"
    Write-Info '(or start an interactive session: turbine repl)'
}

try {
    Main
} catch {
    $message = $_.Exception.Message
    Write-Host 'error: ' -ForegroundColor Red -NoNewline
    if ($message.StartsWith($ErrorMarker)) {
        Write-Host $message.Substring($ErrorMarker.Length)
    } else {
        Write-Host $message
        Write-Host $_.InvocationInfo.PositionMessage -ForegroundColor DarkGray
    }
    # Exit only when run as a file: under `irm | iex`, exit would close your PowerShell window.
    if ($PSCommandPath) { exit 1 }
}

} # end of the child scope
