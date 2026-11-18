@echo off
setlocal EnableExtensions DisableDelayedExpansion
pushd "%~dp0" || exit /b 1

rem Optional argument: the Git ref currently deployed on the server.
set "NONAME_DEPLOY_BASE=%~1"
if not defined NONAME_DEPLOY_BASE set "NONAME_DEPLOY_BASE=main"

powershell.exe -NoLogo -NoProfile -NonInteractive -Command ^
    "$ErrorActionPreference = 'Stop';" ^
    "try {" ^
    "    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false);" ^
    "    $base = git rev-parse --verify --short=12 --end-of-options ($env:NONAME_DEPLOY_BASE + '^{commit}');" ^
    "    if ($LASTEXITCODE -ne 0) { throw 'Deployed Git ref could not be found.' }" ^
    "    $head = git rev-parse --verify --short=12 HEAD;" ^
    "    if ($LASTEXITCODE -ne 0) { throw 'Current Git commit could not be found.' }" ^
    "    $runtimePaths = @('_virtual', 'audio', 'card', 'character', 'extension', 'font', 'game', 'image', 'layout', 'mode', 'node_modules', 'noname', 'theme', 'index.html', 'jit-test.ts', 'noname.js', 'service-worker.js');" ^
    "    $changes = @(git -c core.quotepath=false diff --no-renames --name-status $base $head -- @runtimePaths);" ^
    "    if ($LASTEXITCODE -ne 0) { throw 'Git failed to compare the two commits.' }" ^
    "    if (!$changes.Count) { Write-Host 'No runtime changes to package.'; exit 0 }" ^
    "    $files = @(foreach ($change in $changes) {" ^
    "        $kind, $path = $change -split [char]9, 2;" ^
    "        if ($kind -notin 'A', 'M') { throw ('ZIP overlay cannot apply this change: ' + $change) }" ^
    "        $path" ^
    "    });" ^
    "    $outputDir = Join-Path (Get-Location).Path 'deploy';" ^
    "    $null = New-Item -ItemType Directory -Path $outputDir -Force;" ^
    "    $archive = Join-Path $outputDir ('noname-update-{0}-{1}.zip' -f $base, $head);" ^
    "    git --literal-pathspecs archive --format=zip ('--output=' + $archive) $head -- @files;" ^
    "    if ($LASTEXITCODE -ne 0) { throw 'Git failed to create the update ZIP.' }" ^
    "    Write-Host ('Packaged {0} runtime files from {1} to {2}.' -f $files.Count, $base, $head);" ^
    "    $files | ForEach-Object { Write-Host ('  ' + $_) };" ^
    "    Write-Host $archive;" ^
    "    exit 0;" ^
    "} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }"

set "NONAME_DEPLOY_EXIT=%errorlevel%"
popd
if "%~1"=="" pause
exit /b %NONAME_DEPLOY_EXIT%
