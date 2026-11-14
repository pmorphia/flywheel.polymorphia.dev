<#
.SYNOPSIS
    Flywheel installer for Windows: builds and installs the Flywheel compiler, and optionally
    Pulley (the package manager) and the VS Code extension.

.DESCRIPTION
    Run from PowerShell (no administrator rights needed):

        irm https://flywheel.polymorphia.dev/install.ps1 | iex

    With options:

        & ([scriptblock]::Create((irm https://flywheel.polymorphia.dev/install.ps1))) -All

    What it sets up:
      - Visual Studio 2022 Build Tools with the C++ workload, if no C++ toolset is installed
        (through winget, after asking; Windows shows its own elevation prompt).
      - LLVM, CMake, and Ninja from conda-forge in a private environment under
        %LOCALAPPDATA%\flywheel-install, using a pinned, checksum-verified micromamba.
      - Flywheel in %LOCALAPPDATA%\Programs\Flywheel, added to your user PATH.

.EXAMPLE
    .\install.ps1 -All
.EXAMPLE
    .\install.ps1 -Ref v2.3 -Prefix D:\Tools\Flywheel
.EXAMPLE
    .\install.ps1 -Uninstall
#>
[CmdletBinding()]
param(
    # Also install Pulley, the package manager (needs Python 3.12+).
    [switch]$Pulley,
    # Also install the VS Code extension (needs VS Code and Node.js 22+).
    [switch]$VSCode,
    # Install Flywheel, Pulley, and the VS Code extension.
    [switch]$All,
    # Skip Pulley without asking.
    [switch]$NoPulley,
    # Skip the VS Code extension without asking.
    [switch]$NoVSCode,
    # Installation directory.
    [string]$Prefix = $(if ($env:FLYWHEEL_PREFIX) { $env:FLYWHEEL_PREFIX } else { Join-Path $env:LOCALAPPDATA 'Programs\Flywheel' }),
    # Branch, tag, or commit to build.
    [string]$Ref = 'main',
    # Build Flywheel from a local checkout instead of downloading.
    [string]$Source,
    # Install Pulley from a local checkout.
    [string]$PulleySource,
    # Build the extension from a local checkout.
    [string]$VSCodeSource,
    # Desktop window support.
    [ValidateSet('Auto', 'On', 'Off')]
    [string]$Desktop = 'Auto',
    # Use an existing LLVM (the directory containing LLVMConfig.cmake) instead of conda-forge's.
    [string]$LlvmDir,
    # Answer yes to every question.
    [switch]$Yes,
    # Do not install tools; fail if something is missing.
    [switch]$NoDeps,
    # Do not add Flywheel to the user PATH.
    [switch]$NoModifyPath,
    # Keep the build directory.
    [switch]$KeepBuild,
    # Print what would be done without changing anything.
    [switch]$DryRun,
    # Remove Flywheel (and Pulley / the extension if installed).
    [switch]$Uninstall,
    # Show help.
    [switch]$Help
)

# Everything below runs in a child scope, so `irm | iex` leaves no functions, variables, or
# preference changes behind in your session. The script is parsed completely before anything
# runs, so a partially downloaded copy does nothing.
& {

$FlywheelRepo = 'https://github.com/fwlang/flywheel'
$PulleyRepo = 'https://github.com/fwlang/pulley'
$VSCodeRepo = 'https://github.com/fwlang/vscode-flywheel'
$ExtensionId = 'fwlang.flywheel-language'
$LlvmPackage = 'llvmdev=21.1.8'
$MicromambaUrl = 'https://github.com/mamba-org/micromamba-releases/releases/download/2.9.0-0/micromamba-win-64.exe'
$MicromambaSha256 = 'a6d804394b2418991c4e29562853eaace2f2ce9d9da661a98e74e02e8dbb44b0'
$ToolsRoot = Join-Path $env:LOCALAPPDATA 'flywheel-install'
$CondaEnv = Join-Path $ToolsRoot 'env'
$PythonMinimum = [version]'3.12'
$NodeMinimum = 22

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is far slower with a progress bar
Set-StrictMode -Version 2.0

# --- Output and prompts ------------------------------------------------------------------------

# Overall progress: Main sets Total to the number of steps it will run; each step advances the
# bar. The same bar is drawn by install.sh.
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

$ErrorMarker = 'flywheel-install: '
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
        & $Command @Arguments
    }
    if ($LASTEXITCODE -ne 0) { Stop-Install "'$Command' failed with exit code $LASTEXITCODE" }
}

# Runs the build, drawing a progress bar from Ninja's "[12/345]" status lines when the output is a
# console. The output is kept and shown if the build fails.
function Invoke-Build {
    param([Parameter(Mandatory)][string]$Command, [string[]]$Arguments = @())
    if ($DryRun -or [Console]::IsOutputRedirected) { Invoke-Native $Command $Arguments; return }
    Write-Host "    `$ $Command $($Arguments -join ' ')" -ForegroundColor DarkGray
    $ErrorActionPreference = 'Continue' # see Invoke-Probe
    $log = New-Object System.Collections.Generic.List[string]
    $shown = $false
    & $Command @Arguments 2>&1 | ForEach-Object {
        $line = "$_"
        $log.Add($line)
        if ($line -match '^\[\s*(\d+)/(\d+)\]' -and [int]$Matches[2] -gt 0) {
            $done = [int]$Matches[1]; $total = [int]$Matches[2]
            $percent = [math]::Floor($done * 100 / $total)
            Write-Host ("`r    {0} {1,3}%" -f (Format-Bar $done $total), $percent) -NoNewline
            $shown = $true
        }
    }
    $code = $LASTEXITCODE
    # The last status line is not always N/N; on success show the bar full.
    if ($shown -and $code -eq 0) { Write-Host ("`r    {0} 100%" -f (Format-Bar 1 1)) -NoNewline }
    if ($shown) { Write-Host '' }
    if ($code -ne 0) {
        $log | Select-Object -Last 40 | ForEach-Object { Write-Host $_ }
        Stop-Install "'$Command' failed with exit code $code (log above)"
    }
}

# Runs native commands whose stderr is redirected. Windows PowerShell 5.1 turns redirected
# stderr into errors, which 'Stop' would make fatal; exit codes are checked instead.
function Invoke-Probe([scriptblock]$Block) {
    $ErrorActionPreference = 'Continue'
    & $Block
}

function Test-Command([string]$Name) { return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

# Picks up PATH changes made by installers (winget, pipx) in this session.
function Update-SessionPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = (@($machine, $user) | Where-Object { $_ }) -join ';'
}

# --- Downloads ---------------------------------------------------------------------------------

function New-WorkDirectory {
    $path = Join-Path ([IO.Path]::GetTempPath()) ("flywheel-install-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $path | Out-Null
    return $path
}

function Remove-WorkDirectory([string]$Path) {
    if ($Path -and (Test-Path $Path)) {
        if ($KeepBuild) { Write-Info "build files kept in $Path" }
        else { Remove-Item -Recurse -Force $Path -ErrorAction SilentlyContinue }
    }
}

# The installer loads the Visual Studio environment and extends PATH; under `irm | iex` that
# would otherwise stay in your session.
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

# The tree of $Ref from a GitHub repository, extracted into $Directory.
function Get-Source([string]$Repo, [string]$Directory) {
    $zip = "$Directory.zip"
    try { Get-File "$Repo/archive/$Ref.zip" $zip }
    catch { Stop-Install "cannot download $Repo at '$Ref' (is the branch, tag, or commit right?)" }
    if ($DryRun) { return }
    # GitHub answers with an HTML page, not an error, for an empty repository.
    $stream = [IO.File]::OpenRead($zip)
    try { $first = $stream.ReadByte(); $second = $stream.ReadByte() } finally { $stream.Dispose() }
    if ($first -ne 0x50 -or $second -ne 0x4B) {
        Stop-Install "$Repo has no '$Ref' to download (the repository may be empty or private)"
    }
    $unpacked = "$Directory.unpacked"
    Expand-Archive -Path $zip -DestinationPath $unpacked -Force
    $root = Get-ChildItem -Path $unpacked -Directory | Select-Object -First 1
    Move-Item -Path $root.FullName -Destination $Directory
    Remove-Item -Recurse -Force $unpacked, $zip
}

# A local checkout, without .git, node_modules, and build products.
function Copy-Source([string]$From, [string]$Directory) {
    Write-Host "    `$ copy $From" -ForegroundColor DarkGray
    if ($DryRun) { return }
    $skip = @('.git', 'node_modules', 'build', '.venv')
    New-Item -ItemType Directory -Path $Directory -Force | Out-Null
    Get-ChildItem -Path $From -Force | Where-Object { $skip -notcontains $_.Name -and $_.Extension -ne '.vsix' } |
        Copy-Item -Destination $Directory -Recurse -Force
}

function Resolve-Checkout([string]$Path, [string]$Marker, [string]$Option) {
    if (-not $Path) { return $null }
    $full = (Resolve-Path -Path $Path -ErrorAction SilentlyContinue)
    if (-not $full -or -not (Test-Path (Join-Path $full $Marker))) { Stop-Install "${Option}: $Path is not the expected checkout" }
    return $full.Path
}

# --- Visual Studio -----------------------------------------------------------------------------

function Find-VisualStudio {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path $vswhere)) { return $null }
    $path = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($path -and (Test-Path (Join-Path $path 'Common7\Tools\VsDevCmd.bat'))) { return $path }
    return $null
}

function Install-VisualStudio {
    if ($NoDeps) { Stop-Install 'Visual Studio 2022 with the C++ workload is required (rerun without -NoDeps to install it)' }
    if (-not (Test-Command winget)) {
        Stop-Install 'install "Build Tools for Visual Studio 2022" with "Desktop development with C++" from https://visualstudio.microsoft.com/downloads/, then rerun'
    }
    Write-Info 'No Visual Studio C++ toolset was found. The free "Build Tools for Visual Studio 2022"'
    Write-Info 'with the C++ workload will be installed (several GB; Windows asks for permission).'
    if (-not (Confirm-Step 'Install Visual Studio Build Tools now?' $true)) { Stop-Install 'the Visual Studio C++ tools are required' }
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

# --- LLVM, CMake, Ninja ------------------------------------------------------------------------

function Get-Micromamba {
    $exe = Join-Path $ToolsRoot 'micromamba.exe'
    if ((Test-Path $exe) -and (Get-FileHash $exe -Algorithm SHA256).Hash -eq $MicromambaSha256) { return $exe }
    if ($DryRun) { Write-Info "would download micromamba to $exe"; return $exe }
    New-Item -ItemType Directory -Path $ToolsRoot -Force | Out-Null
    Get-File $MicromambaUrl "$exe.download"
    $hash = (Get-FileHash "$exe.download" -Algorithm SHA256).Hash
    if ($hash -ne $MicromambaSha256) {
        Remove-Item "$exe.download" -Force
        Stop-Install "micromamba download has checksum $hash, expected $MicromambaSha256"
    }
    Move-Item "$exe.download" $exe -Force
    return $exe
}

function Install-BuildTools {
    Write-Step 'Checking build tools'
    $vs = Find-VisualStudio
    if (-not $vs) {
        Install-VisualStudio
        $vs = Find-VisualStudio
        if (-not $vs -and -not $DryRun) { Stop-Install 'Visual Studio C++ tools are still not found; finish the installation and rerun' }
    }
    if ($vs) {
        Write-Ok "Visual Studio C++ tools ($vs)"
        Enter-DeveloperShell $vs
    }

    if ($LlvmDir) {
        if (-not (Test-Path (Join-Path $LlvmDir 'LLVMConfig.cmake'))) { Stop-Install "-LlvmDir: no LLVMConfig.cmake in $LlvmDir" }
        foreach ($tool in 'cmake', 'ninja') {
            if (-not (Test-Command $tool)) { Stop-Install "-LlvmDir needs $tool on PATH" }
        }
        Write-Ok "LLVM ($LlvmDir)"
        return
    }
    $library = Join-Path $CondaEnv 'Library'
    if (-not (Test-Path (Join-Path $library 'lib\cmake\llvm\LLVMConfig.cmake'))) {
        if ($NoDeps) { Stop-Install 'LLVM is not installed (rerun without -NoDeps, or pass -LlvmDir)' }
        Write-Info "LLVM, CMake, and Ninja will be installed from conda-forge into $CondaEnv (about 1 GB)."
        if (-not (Confirm-Step 'Download them now?' $true)) { Stop-Install 'LLVM is required' }
        $micromamba = Get-Micromamba
        Invoke-Native $micromamba @('create', '--yes', '--quiet', '--root-prefix', (Join-Path $ToolsRoot 'mamba'),
            '--prefix', $CondaEnv, '--channel', 'conda-forge', '--override-channels', $LlvmPackage, 'zlib', 'zstd', 'cmake', 'ninja')
    }
    # llvmdev only brings the zlib and zstd DLLs. LLVM's CMake files also need their headers and import
    # libraries, or configuring fails with "ZLIB::ZLIB but the target was not found". Environments made
    # by older versions of this script lack them, so add them in place.
    $haveCompress = (Test-Path (Join-Path $library 'include\zlib.h')) -and (Test-Path (Join-Path $library 'include\zstd.h'))
    if (-not $haveCompress) {
        if ($NoDeps) { Stop-Install "zlib and zstd development files are missing from $CondaEnv (rerun without -NoDeps)" }
        if ($DryRun) { Write-Info "would install zlib and zstd into $CondaEnv" }
        else {
            Write-Info "Adding zlib and zstd development files to $CondaEnv."
            $micromamba = Get-Micromamba
            Invoke-Native $micromamba @('install', '--yes', '--quiet', '--root-prefix', (Join-Path $ToolsRoot 'mamba'),
                '--prefix', $CondaEnv, '--channel', 'conda-forge', '--override-channels', 'zlib', 'zstd')
        }
    }
    $env:Path = "$library\bin;$CondaEnv;$env:Path"
    Write-Ok "LLVM, zlib, zstd, CMake, and Ninja ($CondaEnv)"
}

# --- Flywheel ----------------------------------------------------------------------------------

# Copies DLLs the compiler needs from the conda environment (for example zstd or zlib) next to it.
function Copy-CompilerDlls {
    $exe = Join-Path $Prefix 'bin\flywheel.exe'
    if (-not (Test-Command dumpbin)) { return }
    $library = Join-Path $CondaEnv 'Library\bin'
    if (-not (Test-Path $library)) { return }
    $dependents = Invoke-Probe { & dumpbin /nologo /dependents $exe } | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '\.dll$' }
    foreach ($dll in $dependents) {
        $candidate = Join-Path $library $dll
        if (Test-Path $candidate) {
            Copy-Item $candidate (Join-Path $Prefix 'bin') -Force
            Write-Info "copied $dll from the build environment"
        }
    }
}

function Install-Flywheel {
    if ($Source) {
        $src = $Source
        Write-Step "Building Flywheel from $src"
    } else {
        $src = Join-Path $Work 'flywheel'
        Write-Step "Downloading Flywheel ($Ref)"
        Get-Source $FlywheelRepo $src
        Write-Step 'Building Flywheel'
    }
    $build = Join-Path $Work 'build'
    $configure = @('-S', $src, '-B', $build, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release',
        "-DFLYWHEEL_DESKTOP=$($Desktop.ToUpper())", '-Wno-dev')
    if ($LlvmDir) { $configure += "-DLLVM_DIR=$LlvmDir" }
    else { $configure += "-DCMAKE_PREFIX_PATH=$CondaEnv;$(Join-Path $CondaEnv 'Library')" }
    Write-Info 'This takes a few minutes; the first build also downloads SQLite and Mbed TLS.'
    Invoke-Native cmake $configure -Quiet
    Invoke-Build cmake @('--build', $build, '--parallel', [string][Environment]::ProcessorCount)

    Write-Step "Installing Flywheel into $Prefix"
    Invoke-Native cmake @('--install', $build, '--prefix', $Prefix) -Quiet
    if ($DryRun) { return }
    Copy-CompilerDlls
    Install-Alias
    Write-DeveloperShortcut
    $version = & (Join-Path $Prefix 'bin\flywheel.exe') --version
    if ($LASTEXITCODE -ne 0) { Stop-Install 'the installed compiler does not run' }
    & (Join-Path $Prefix 'bin\fw.exe') --version | Out-Null
    if ($LASTEXITCODE -ne 0) { Stop-Install 'the fw alias does not run' }
    Write-Ok $version
}

# `fw` is a shorter name for `flywheel`: a hard link to flywheel.exe (no administrator rights or
# Developer Mode needed, unlike a symlink), so it works from cmd, PowerShell, and scripts alike.
# It is recreated on every install so it never points at an older compiler. Flywheel finds its
# runtime relative to the bin directory, which both share.
function Install-Alias {
    $bin = Join-Path $Prefix 'bin'
    $alias = Join-Path $bin 'fw.exe'
    $target = Join-Path $bin 'flywheel.exe'
    if (Test-Path $alias) { Remove-Item -Force $alias }
    try {
        New-Item -ItemType HardLink -Path $alias -Target $target | Out-Null
    } catch {
        Copy-Item $target $alias # file systems without hard links (FAT32, exFAT)
    }
    $existing = Get-Command fw -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existing -and $existing.Source -ine $alias) { Write-Warn "another fw is on PATH ($($existing.Source)); it may shadow Flywheel's fw alias" }
    Write-Ok 'fw -> flywheel'
}

# Running programs and `flywheel --build` link with MSVC, which needs the Visual Studio environment.
# flywheel-shell opens a prompt with that environment and Flywheel on PATH.
function Write-DeveloperShortcut {
    $vs = Find-VisualStudio
    if (-not $vs) { return }
    $devcmd = Join-Path $vs 'Common7\Tools\VsDevCmd.bat'
    $bin = Join-Path $Prefix 'bin'
    $content = @"
@echo off
rem Opens a prompt where Flywheel can build and run programs (MSVC environment + Flywheel).
call "$devcmd" -arch=amd64 -host_arch=amd64 -no_logo
set "PATH=$bin;%PATH%"
if "%~1"=="" (cmd /k) else (%*)
"@
    Set-Content -Path (Join-Path $bin 'flywheel-shell.cmd') -Value $content -Encoding ASCII
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
    $env:Path = "$bin;$env:Path"
    Write-Ok 'user PATH updated (new terminals pick it up)'
}

function Remove-FromPath {
    $bin = Join-Path $Prefix 'bin'
    $entries = Get-UserPathEntries
    $kept = @($entries | Where-Object { $_.TrimEnd('\') -ine $bin })
    if ($kept.Count -ne $entries.Count) { Set-UserPathEntries $kept; Write-Ok "removed $bin from PATH" }
}

# --- Pulley ------------------------------------------------------------------------------------

# Every place a Python interpreter may be registered, as { Command; Arguments } to probe.
# PATH alone is not enough: python.org installs may skip it, the py launcher may default to an
# older version (py.ini, PY_PYTHON), and 'python' may be the Microsoft Store placeholder.
function Get-PythonCandidates {
    $minor = $PythonMinimum.Minor
    # Only list what the py launcher knows: asking it for a version (py -3.13) can make the
    # Python install manager download that version.
    if (Test-Command py) {
        foreach ($listing in @('--list-paths'), @('list', '--format=exe')) {
            $listed = Invoke-Probe { & py @listing 2>$null }
            if ($LASTEXITCODE -ne 0) { continue }
            foreach ($line in @($listed)) {
                if ("$line" -match '([A-Za-z]:\\.*?\\python[\d.]*\.exe)\s*$') { [pscustomobject]@{ Command = $Matches[1]; Arguments = @() } }
            }
        }
    }
    # PEP 514 registrations (python.org, winget, and most distributions).
    foreach ($root in 'HKCU:\Software\Python', 'HKLM:\Software\Python', 'HKLM:\Software\WOW6432Node\Python') {
        if (-not (Test-Path $root)) { continue }
        foreach ($key in @(Get-ChildItem $root -ErrorAction SilentlyContinue | Get-ChildItem -ErrorAction SilentlyContinue)) {
            $props = Get-ItemProperty -LiteralPath "$($key.PSPath)\InstallPath" -ErrorAction SilentlyContinue
            if (-not $props) { continue }
            $exe = $null
            if ($props.PSObject.Properties['ExecutablePath']) { $exe = $props.ExecutablePath }
            elseif ($props.PSObject.Properties['(default)']) { $exe = Join-Path $props.'(default)' 'python.exe' }
            if ($exe) { [pscustomobject]@{ Command = $exe; Arguments = @() } }
        }
    }
    # Default install folders (python.org per-user and all-users, the Python install manager).
    $folders = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python3*\python.exe'),
        (Join-Path $env:LOCALAPPDATA 'Python\pythoncore-3*\python.exe'),
        (Join-Path $env:ProgramFiles 'Python3*\python.exe'),
        (Join-Path $env:SystemDrive 'Python3*\python.exe'))
    foreach ($pattern in $folders) {
        foreach ($file in @(Get-ChildItem $pattern -ErrorAction SilentlyContinue)) { [pscustomobject]@{ Command = $file.FullName; Arguments = @() } }
    }
    $names = @('python', 'python3') + @((20..$minor) | ForEach-Object { "python3.$_" })
    foreach ($command in @(Get-Command $names -CommandType Application -All -ErrorAction SilentlyContinue)) {
        [pscustomobject]@{ Command = $command.Source; Arguments = @() }
    }
}

# The full path of the newest Python 3.12+ found, or $null.
function Find-Python {
    # No double quotes in the program: Windows PowerShell 5.1 (and pwsh before 7.3) passes them
    # to native commands unescaped, which turned the old probe into a Python syntax error and made
    # every installed Python look missing.
    $probe = 'import sys; print(sys.version_info[0], sys.version_info[1], sys.executable)'
    $tried = @{}
    $best = $null
    $bestVersion = $null
    foreach ($candidate in @(Get-PythonCandidates)) {
        $key = "$($candidate.Command) $($candidate.Arguments -join ' ')".ToLowerInvariant()
        if ($tried.ContainsKey($key)) { continue }
        $tried[$key] = $true
        if ($candidate.Command -match '[\\/]' -and -not (Test-Path -LiteralPath $candidate.Command)) { continue }
        $command = $candidate.Command
        $arguments = @($candidate.Arguments) + @('-c', $probe)
        $output = Invoke-Probe { & $command @arguments 2>$null }
        if ($LASTEXITCODE -ne 0) { continue }
        foreach ($line in @($output)) {
            if ("$line" -notmatch '^(\d+) (\d+) (.+)$') { continue }
            $version = [version]"$($Matches[1]).$($Matches[2])"
            $exe = $Matches[3].Trim()
            if ($version -lt $PythonMinimum -or -not (Test-Path -LiteralPath $exe)) { continue }
            if (-not $bestVersion -or $version -gt $bestVersion) { $best = $exe; $bestVersion = $version }
        }
    }
    return $best
}

function Install-Pulley {
    Write-Step 'Installing Pulley'
    $python = Find-Python
    if (-not $python) {
        if ($NoDeps -or -not (Test-Command winget)) { Stop-Install "Pulley needs Python $PythonMinimum or later (https://www.python.org/downloads/)" }
        if (-not (Confirm-Step 'Python 3.12+ was not found. Install Python 3.13 with winget?' $true)) { Stop-Install 'Python is required for Pulley' }
        Invoke-Native winget @('install', '--id', 'Python.Python.3.13', '--exact', '--source', 'winget', '--scope', 'user',
            '--accept-package-agreements', '--accept-source-agreements')
        Update-SessionPath
        $python = Find-Python
        if (-not $python -and -not $DryRun) { Stop-Install 'Python was installed but cannot be found; open a new terminal and rerun with -Pulley' }
    }
    if ($python) { Write-Ok "Python ($python)" } else { $python = 'python' } # dry run only
    if (-not $DryRun) {
        Invoke-Probe { & $python -m pipx --version *> $null }
        if ($LASTEXITCODE -ne 0) {
            Invoke-Probe { & $python -m pip --version *> $null }
            if ($LASTEXITCODE -ne 0) { Invoke-Native $python @('-m', 'ensurepip', '--default-pip') -Quiet }
            Invoke-Native $python @('-m', 'pip', 'install', '--user', '--quiet', 'pipx')
        }
        Write-Ok "pipx $(Invoke-Probe { & $python -m pipx --version 2>$null })"
    }
    $src = Join-Path $Work 'pulley'
    if ($PulleySource) { Copy-Source $PulleySource $src } else { Get-Source $PulleyRepo $src }
    Invoke-Native $python @('-m', 'pipx', 'install', '--force', '--python', $python, $src)
    if (-not $NoModifyPath) { Invoke-Native $python @('-m', 'pipx', 'ensurepath') -Quiet }
    if ($DryRun) { return }
    $binDir = Invoke-Probe { & $python -m pipx environment --value PIPX_BIN_DIR 2>$null }
    if ($LASTEXITCODE -ne 0 -or -not $binDir) { $binDir = Join-Path $env:USERPROFILE '.local\bin' }
    $binDir = "$binDir".Trim()
    $pulley = Join-Path $binDir 'pulley.exe'
    Invoke-Probe { & $pulley config flywheel (Join-Path $Prefix 'bin\flywheel.exe') 2>$null } | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Warn "could not point Pulley at the compiler; run: pulley config flywheel `"$Prefix\bin\flywheel.exe`"" }
    Write-Ok "$(& $pulley --version) (uses $Prefix\bin\flywheel.exe)"
}

# --- VS Code extension -------------------------------------------------------------------------

function Find-VSCode {
    foreach ($name in 'code', 'code-insiders', 'codium') {
        $command = Get-Command "$name.cmd" -ErrorAction SilentlyContinue
        if ($command) { return $command.Source }
    }
    foreach ($path in @((Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code\bin\code.cmd'),
            (Join-Path $env:ProgramFiles 'Microsoft VS Code\bin\code.cmd'))) {
        if (Test-Path $path) { return $path }
    }
    return $null
}

function Test-Node {
    if (-not (Test-Command node) -or -not (Test-Command npm)) { return $false }
    $major = Invoke-Probe { & node -p 'process.versions.node.split(".")[0]' 2>$null }
    return ($LASTEXITCODE -eq 0) -and ([int]$major -ge $NodeMinimum)
}

function Install-VSCodeExtension {
    Write-Step 'Installing the VS Code extension'
    $code = Find-VSCode
    if (-not $code) { Stop-Install 'VS Code was not found; install it from https://code.visualstudio.com and rerun with -VSCode' }
    if (-not (Test-Node)) {
        if ($NoDeps -or -not (Test-Command winget)) { Stop-Install "building the extension needs Node.js $NodeMinimum or later (https://nodejs.org)" }
        if (-not (Confirm-Step "Node.js $NodeMinimum+ was not found. Install the Node.js LTS with winget?" $true)) { Stop-Install 'Node.js is required to build the extension' }
        Invoke-Native winget @('install', '--id', 'OpenJS.NodeJS.LTS', '--exact', '--source', 'winget',
            '--accept-package-agreements', '--accept-source-agreements')
        Update-SessionPath
        if (-not (Test-Node) -and -not $DryRun) { Stop-Install 'Node.js was installed but cannot be found; open a new terminal and rerun with -VSCode' }
    }
    $src = Join-Path $Work 'vscode-flywheel'
    if ($VSCodeSource) { Copy-Source $VSCodeSource $src } else { Get-Source $VSCodeRepo $src }
    Push-Location -Path $(if ($DryRun) { $PWD } else { $src })
    try {
        Invoke-Native npm.cmd @('ci', '--no-audit', '--no-fund', '--loglevel=error')
        Invoke-Native npm.cmd @('run', '--silent', 'package') -Quiet
    } finally { Pop-Location }
    Invoke-Native $code @('--install-extension', (Join-Path $src 'flywheel-language.vsix'), '--force') -Quiet
    Write-Ok "$ExtensionId installed"
}

# --- Uninstall ---------------------------------------------------------------------------------

function Invoke-Uninstall {
    Write-Step 'Uninstalling Flywheel'
    if (Test-Path (Join-Path $Prefix 'bin\flywheel.exe')) {
        $modules = Join-Path $Prefix 'modules'
        if ((Test-Path $modules) -and (Get-ChildItem $modules -Force | Select-Object -First 1)) {
            Write-Warn "$modules holds globally installed packages; they are removed too"
        }
        if (-not (Confirm-Step "Remove $Prefix?" $true)) { Stop-Install 'cancelled' }
        if (-not $DryRun) { Remove-Item -Recurse -Force $Prefix }
        Write-Ok "removed $Prefix"
    } else {
        Write-Info "no Flywheel installation in $Prefix (use -Prefix to choose another)"
    }
    Remove-FromPath
    $python = Find-Python
    if ($python) {
        $installed = Invoke-Probe { & $python -m pipx list --short 2>$null }
        if ($LASTEXITCODE -eq 0 -and ($installed -match '^fw-pulley ') -and (Confirm-Step 'Uninstall Pulley too?' $true)) {
            Invoke-Native $python @('-m', 'pipx', 'uninstall', 'fw-pulley')
        }
    }
    $code = Find-VSCode
    if ($code) {
        $extensions = Invoke-Probe { & $code --list-extensions 2>$null }
        if (($extensions -contains $ExtensionId) -and (Confirm-Step 'Uninstall the VS Code extension too?' $true)) {
            Invoke-Native $code @('--uninstall-extension', $ExtensionId) -Quiet
        }
    }
    if ((Test-Path $ToolsRoot) -and (Confirm-Step "Remove the build tools in $ToolsRoot (LLVM, CMake, Ninja)?" $true)) {
        if (-not $DryRun) { Remove-Item -Recurse -Force $ToolsRoot }
        Write-Ok "removed $ToolsRoot"
    }
    Write-Info 'Visual Studio Build Tools, Python, and Node.js were left installed.'
    Write-Host ''
    Write-Host 'Flywheel has been uninstalled.' -ForegroundColor Green
}

# --- Main --------------------------------------------------------------------------------------

function Show-Usage {
    @'
Install Flywheel on Windows.

  irm https://flywheel.polymorphia.dev/install.ps1 | iex
  & ([scriptblock]::Create((irm https://flywheel.polymorphia.dev/install.ps1))) -All
  .\install.ps1 [options]

Components
  -Pulley              also install Pulley, the package manager (needs Python 3.12+)
  -VSCode              also install the VS Code extension (needs VS Code and Node.js 22+)
  -All                 install all three
  -NoPulley, -NoVSCode skip without asking

Where and what
  -Prefix DIR          install directory (default: %LOCALAPPDATA%\Programs\Flywheel)
  -Ref REF             branch, tag, or commit to build (default: main)
  -Source DIR          build Flywheel from a local checkout
  -PulleySource DIR    install Pulley from a local checkout
  -VSCodeSource DIR    build the extension from a local checkout
  -Desktop MODE        desktop window support: Auto (default), On, Off
  -LlvmDir DIR         use an existing LLVM (directory with LLVMConfig.cmake)

Behaviour
  -Yes                 answer yes to every question
  -NoDeps              do not install tools; fail if something is missing
  -NoModifyPath        do not add Flywheel to the user PATH
  -KeepBuild           keep the build directory
  -DryRun              print what would be done without changing anything
  -Uninstall           remove Flywheel (and Pulley / the extension if installed)
  -Help                show this help
'@ | Write-Host
}

function Main {
    if ($Help) { Show-Usage; return }
    if ($env:OS -ne 'Windows_NT') { Stop-Install 'this installer is for Windows; on Linux use install.sh' }
    if (-not [Environment]::Is64BitOperatingSystem) { Stop-Install 'Flywheel needs 64-bit Windows' }
    # Windows PowerShell 5.1 does not enable TLS 1.2 by default.
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    # Locals here are visible to every function Main calls.
    $Prefix = [IO.Path]::GetFullPath($Prefix)
    $Source = Resolve-Checkout $Source 'CMakeLists.txt' '-Source'
    $PulleySource = Resolve-Checkout $PulleySource 'pyproject.toml' '-PulleySource'
    $VSCodeSource = Resolve-Checkout $VSCodeSource 'package.json' '-VSCodeSource'

    if ($Uninstall) { Invoke-Uninstall; return }

    $wantPulley = $Pulley -or $All -or [bool]$PulleySource
    $wantVSCode = $VSCode -or $All -or [bool]$VSCodeSource
    Write-Host 'Flywheel installer' -ForegroundColor White
    $origin = if ($Source) { $Source } else { "$FlywheelRepo @ $Ref" }
    Write-Info "Flywheel:  $Prefix  ($origin)"
    if (-not $wantPulley -and -not $NoPulley -and -not $Yes -and (Test-Interactive)) {
        $wantPulley = Confirm-Step 'Also install Pulley, the Flywheel package manager?' $false
    }
    if (-not $wantVSCode -and -not $NoVSCode -and -not $Yes -and (Test-Interactive) -and (Find-VSCode)) {
        $wantVSCode = Confirm-Step 'Also install the Flywheel extension for VS Code?' $false
    }
    if ($wantPulley) { Write-Info 'Pulley:    pipx (fw-pulley)' }
    if ($wantVSCode) { Write-Info "VS Code:   $ExtensionId" }
    if ($DryRun) { Write-Info 'dry run: nothing will be changed' }

    # One step each: build tools, download (unless -Source), build, install, PATH, extras.
    $Progress.Total = 3 + [int](-not $Source) + [int](-not $NoModifyPath) + [int]$wantPulley + [int]$wantVSCode
    $Work = New-WorkDirectory
    $environment = Save-Environment
    try {
        Install-BuildTools
        Install-Flywheel
        Add-ToPath
        if ($wantPulley) { Install-Pulley }
        if ($wantVSCode) { Install-VSCodeExtension }
    } finally {
        Restore-Environment $environment
        Remove-WorkDirectory $Work
    }
    # Flywheel works in this session too, not only in new terminals.
    if (-not $NoModifyPath -and -not $DryRun) { $env:Path = "$(Join-Path $Prefix 'bin');$env:Path" }

    Write-Host ''
    if ($DryRun) { Write-Host 'Dry run complete. Nothing was changed.' -ForegroundColor Green; return }
    Write-Host 'Flywheel is installed.' -ForegroundColor Green
    Write-Info 'Building and running programs needs the Visual Studio environment. Use either'
    Write-Info '  flywheel-shell              (opens a prompt with it, from any new terminal)'
    Write-Info '  Developer PowerShell for VS 2022 (from the Start menu)'
    Write-Info 'then try:'
    Write-Info "  'print `"Hello, world!`"' | Set-Content hello.fw; flywheel hello.fw"
    Write-Info '(fw is a short alias for flywheel: fw run hello.fw)'
    if ($wantVSCode) { Write-Info 'Restart VS Code so the extension finds flywheel on PATH.' }
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
