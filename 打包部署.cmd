@echo off
setlocal EnableExtensions DisableDelayedExpansion
pushd "%~dp0" || exit /b 1

rem Optional argument: the Git ref currently deployed on the server.
rem With no argument, use the locally recorded deployment when available.
set "NONAME_DEPLOY_BASE=%~1"

powershell.exe -NoLogo -NoProfile -NonInteractive -Command ^
    "$ErrorActionPreference = 'Stop';" ^
    "try {" ^
    "    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false);" ^
    "    $baseRef = $env:NONAME_DEPLOY_BASE;" ^
    "    if (!$baseRef) {" ^
    "        git show-ref --verify --quiet refs/noname/deployed;" ^
    "        if ($LASTEXITCODE -eq 0) { $baseRef = 'refs/noname/deployed' }" ^
    "        elseif ($LASTEXITCODE -eq 1) { $baseRef = 'main' }" ^
    "        else { throw 'Git could not read the recorded deployment.' }" ^
    "    }" ^
    "    $base = git rev-parse --verify --short=12 --end-of-options ($baseRef + '^{commit}');" ^
    "    if ($LASTEXITCODE -ne 0) { throw 'Deployed Git ref could not be found.' }" ^
    "    $head = git rev-parse --verify --short=12 HEAD;" ^
    "    if ($LASTEXITCODE -ne 0) { throw 'Current Git commit could not be found.' }" ^
    "    $target = $head;" ^
    "    if ($baseRef -eq 'refs/noname/deployed') {" ^
    "        $merged = @(git merge-tree --write-tree $base $head);" ^
    "        if ($LASTEXITCODE -ne 0) {" ^
    "            $merged | Write-Host;" ^
    "            throw 'Current changes conflict with the recorded deployment.';" ^
    "        }" ^
    "        $target = $merged[0];" ^
    "    }" ^
    "    $runtimePaths = @('_virtual', 'audio', 'card', 'character', 'extension', 'font', 'game', 'image', 'layout', 'mode', 'node_modules', 'noname', 'theme', 'index.html', 'jit-test.ts', 'noname.js', 'service-worker.js', 'lobby/dist/cli.cjs');" ^
    "    $changes = @(git -c core.quotepath=false diff --no-renames --name-status $base $target -- @runtimePaths);" ^
    "    if ($LASTEXITCODE -ne 0) { throw 'Git failed to compare the two commits.' }" ^
    "    if (!$changes.Count) {" ^
    "        if (!$env:NONAME_DEPLOY_BASE -and $baseRef -eq 'main' -and $base -eq $head) {" ^
    "            throw 'No deployment is recorded. Pass the deployed Git ref as the first argument.';" ^
    "        }" ^
    "        Write-Host 'No runtime changes to package.'; exit 0;" ^
    "    }" ^
    "    $files = @(foreach ($change in $changes) {" ^
    "        $kind, $path = $change -split [char]9, 2;" ^
    "        if ($kind -notin 'A', 'M') { throw ('ZIP overlay cannot apply this change: ' + $change) }" ^
    "        $path" ^
    "    });" ^
    "    $outputDir = Join-Path (Get-Location).Path 'deploy';" ^
    "    $null = New-Item -ItemType Directory -Path $outputDir -Force;" ^
    "    $archive = Join-Path $outputDir ('noname-update-{0}-{1}.zip' -f $base, $head);" ^
    "    git --literal-pathspecs archive --format=zip ('--output=' + $archive) $target -- @files;" ^
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
