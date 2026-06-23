# Shared helpers for remote Windows CI steps (workspace-e2e MAPT VM).
# Dot-source from remote scripts: . "$env:USERPROFILE\ci-scripts\windows-remote-helpers.ps1"
#
# Runner-side orchestration (GitHub Actions ubuntu) lives in workspace-e2e-runner.sh.

function Invoke-DownloadWithRetry {
  param(
    [Parameter(Mandatory)][string]$Uri,
    [Parameter(Mandatory)][string]$OutFile,
    [int]$MaxAttempts = 3,
    [long]$MinBytes = 1024,
    [hashtable]$Headers = @{}
  )

  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    Write-Host "Downloading $Uri (attempt $attempt/$MaxAttempts)..."
    try {
      if (Test-Path $OutFile) {
        Remove-Item $OutFile -Force -ErrorAction SilentlyContinue
      }
      $requestHeaders = @{ 'User-Agent' = 'kaiden-workspace-e2e' }
      foreach ($key in $Headers.Keys) {
        $requestHeaders[$key] = $Headers[$key]
      }
      Invoke-WebRequest -Uri $Uri -OutFile $OutFile -UseBasicParsing -Headers $requestHeaders
      if (-not (Test-Path $OutFile)) {
        throw "Output file missing after download"
      }
      $size = (Get-Item $OutFile).Length
      if ($size -lt $MinBytes) {
        throw "Download too small ($size bytes, minimum $MinBytes)"
      }
      Write-Host "Downloaded $size bytes to $OutFile"
      return
    } catch {
      Write-Host "Download attempt $attempt failed: $_"
      if ($attempt -eq $MaxAttempts) {
        throw
      }
      Start-Sleep -Seconds (10 * $attempt)
    }
  }
}

function Invoke-MsiInstallWithRetry {
  param(
    [Parameter(Mandatory)][string]$MsiPath,
    [int]$MaxAttempts = 3
  )

  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    Write-Host "Installing MSI (attempt $attempt/$MaxAttempts): $MsiPath"
    $proc = Start-Process msiexec.exe -ArgumentList '/package', "`"$MsiPath`"", '/quiet' -Wait -PassThru
    Write-Host "msiexec exit code: $($proc.ExitCode)"
    if ($proc.ExitCode -eq 0) {
      return
    }
    if ($proc.ExitCode -eq 1618 -and $attempt -lt $MaxAttempts) {
      Write-Host 'Windows Installer busy (code 1618), waiting 30s before retry...'
      Start-Sleep -Seconds 30
      continue
    }
    if ($attempt -eq $MaxAttempts) {
      throw "MSI install failed with exit code $($proc.ExitCode)"
    }
    Start-Sleep -Seconds (10 * $attempt)
  }
}

function Invoke-CommandWithRetry {
  param(
    [Parameter(Mandatory)][string]$Label,
    [Parameter(Mandatory)][scriptblock]$Action,
    [int]$MaxAttempts = 3,
    [int]$InitialDelaySeconds = 10
  )

  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    Write-Host "$Label (attempt $attempt/$MaxAttempts)..."
    try {
      & $Action
      if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) {
        throw "Command exited with code $LASTEXITCODE"
      }
      return
    } catch {
      Write-Host "Attempt $attempt failed: $_"
      if ($attempt -eq $MaxAttempts) {
        throw
      }
      Start-Sleep -Seconds ($InitialDelaySeconds * $attempt)
    }
  }
}

function Invoke-NsisInstallWithRetry {
  param(
    [Parameter(Mandatory)][string]$SetupPath,
    [int]$MaxAttempts = 3
  )

  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    Write-Host "Installing NSIS setup (attempt $attempt/$MaxAttempts): $SetupPath"
    $proc = Start-Process -FilePath $SetupPath -ArgumentList '/S' -Wait -PassThru
    Write-Host "NSIS setup exit code: $($proc.ExitCode)"
    if ($proc.ExitCode -eq 0) {
      return
    }
    if ($attempt -eq $MaxAttempts) {
      throw "NSIS setup install failed with exit code $($proc.ExitCode)"
    }
    Start-Sleep -Seconds (10 * $attempt)
  }
}

function Resolve-KaidenInstalledBinary {
  $searchRoots = @(
    (Join-Path $env:LOCALAPPDATA 'Programs'),
    $env:ProgramFiles,
    ${env:ProgramFiles(x86)}
  ) | Where-Object { $_ -and (Test-Path $_) }

  foreach ($root in $searchRoots) {
    $matches = Get-ChildItem -Path $root -Recurse -Filter 'Kaiden.exe' -ErrorAction SilentlyContinue
    foreach ($match in $matches) {
      if ($match.FullName -notmatch '\\Uninstall ') {
        Write-Host "Found installed Kaiden binary: $($match.FullName)"
        return $match.FullName
      }
    }
  }

  throw "Kaiden.exe not found after NSIS install. Searched: $($searchRoots -join ', ')"
}

function Select-KaidenReleaseAsset {
  param(
    [Parameter(Mandatory)]$Release,
    [ValidateSet('setup', 'portable')]
    [string]$InstallMode = 'setup'
  )

  if ($InstallMode -eq 'setup') {
    return $Release.assets | Where-Object {
      $_.name -match '^kaiden-.*-setup-x64\.exe$'
    } | Select-Object -First 1
  }

  return $Release.assets | Where-Object {
    $_.name -match '^kaiden-.*-x64\.exe$' -and $_.name -notmatch 'setup'
  } | Select-Object -First 1
}

function Add-ElevatedFirewallProgramRule {
  param(
    [Parameter(Mandatory)][string]$DisplayNamePrefix,
    [Parameter(Mandatory)][string]$ProgramPath
  )

  if (-not (Test-Path $ProgramPath)) {
    throw "Binary not found: $ProgramPath"
  }

  $fullPath = (Resolve-Path $ProgramPath).Path
  $escapedPath = $fullPath.Replace("'", "''")

  Get-NetFirewallRule -DisplayName "$DisplayNamePrefix*" -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue

  foreach ($direction in @('Inbound', 'Outbound')) {
    $ruleName = "$DisplayNamePrefix $direction"
    $command = "New-NetFirewallRule -DisplayName '$ruleName' -Direction $direction -Program '$escapedPath' -Action Allow -Profile Domain,Private,Public -Enable True"
    Write-Host "Adding elevated firewall rule: $ruleName for $fullPath"
    Start-Process powershell.exe -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $command -Verb RunAs -Wait
  }

  Write-Host "Elevated firewall rules added for $fullPath"
}

function Enable-KaidenFirewallAccess {
  param(
    [Parameter(Mandatory)][string]$BinaryPath
  )

  Add-ElevatedFirewallProgramRule -DisplayNamePrefix 'Kaiden E2E' -ProgramPath $BinaryPath
}

function Enable-PodmanFirewallAccess {
  if (-not (Get-Command podman -ErrorAction SilentlyContinue)) {
    Write-Host 'podman not on PATH, skipping firewall rules'
    return
  }

  $podmanPath = (Get-Command podman).Path
  Add-ElevatedFirewallProgramRule -DisplayNamePrefix 'Kaiden E2E podman' -ProgramPath $podmanPath
}

function Invoke-PodmanCliWithTimeout {
  param(
    [Parameter(Mandatory)][string[]]$PodmanArgs,
    [int]$TimeoutSeconds = 180
  )

  $podmanExe = (Get-Command podman).Source
  $stdoutFile = Join-Path $env:TEMP "podman-$([guid]::NewGuid().Guid).out"
  $stderrFile = Join-Path $env:TEMP "podman-$([guid]::NewGuid().Guid).err"
  $label = "podman $($PodmanArgs -join ' ')"

  Write-Host "$label (timeout ${TimeoutSeconds}s)..."

  try {
    $proc = Start-Process -FilePath $podmanExe -ArgumentList $PodmanArgs `
      -NoNewWindow -PassThru `
      -RedirectStandardOutput $stdoutFile `
      -RedirectStandardError $stderrFile

    if (-not $proc.WaitForExit($TimeoutSeconds * 1000)) {
      Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
      throw "$label timed out after ${TimeoutSeconds}s"
    }

    $proc.Refresh()
    $exitCode = $proc.ExitCode

    if (Test-Path $stdoutFile) {
      Get-Content $stdoutFile | ForEach-Object { Write-Host $_ }
    }
    if (Test-Path $stderrFile) {
      Get-Content $stderrFile | ForEach-Object { Write-Host $_ }
    }

    if ($null -ne $exitCode -and $exitCode -ne 0) {
      throw "$label failed with exit code $exitCode"
    }
  } finally {
    Remove-Item $stdoutFile, $stderrFile -Force -ErrorAction SilentlyContinue
  }
}

function Restart-PodmanMachine {
  param(
    [int]$CommandTimeoutSeconds = 180
  )

  Write-Host 'Restarting Podman machine after readiness failure...'
  try {
    Invoke-PodmanCliWithTimeout -PodmanArgs @('machine', 'stop') -TimeoutSeconds $CommandTimeoutSeconds
  } catch {
    Write-Host "podman machine stop failed (continuing): $_"
  }
  Invoke-PodmanCliWithTimeout -PodmanArgs @('machine', 'start') -TimeoutSeconds ($CommandTimeoutSeconds * 2)
}

function Dismiss-WindowsShellOverlays {
  Write-Host 'Dismissing Windows shell overlays (Start menu, etc.)...'
  try {
    $shell = New-Object -ComObject WScript.Shell
    for ($i = 0; $i -lt 3; $i++) {
      $shell.SendKeys('{ESC}')
      Start-Sleep -Milliseconds 300
    }
    Start-Sleep -Milliseconds 500
  } catch {
    Write-Host "Shell overlay dismiss failed (continuing): $_"
  }
}

function Initialize-PodmanEnvironment {
  param(
    [Parameter(Mandatory)][string]$Provider
  )

  $userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
  if ($userPath) {
    $env:PATH = "$userPath;$env:PATH"
  }

  if (-not (Get-Command podman -ErrorAction SilentlyContinue)) {
    $podmanExe = Resolve-PodmanExecutable
    Add-PodmanToPath -PodmanExe $podmanExe
  }

  $env:CONTAINERS_MACHINE_PROVIDER = $Provider
}

function Ensure-PodmanMachineRunning {
  param(
    [string]$Provider = 'wsl',
    [int]$CommandTimeoutSeconds = 120
  )

  Initialize-PodmanEnvironment -Provider $Provider
  Write-Host "Ensuring Podman machine is running before E2E tests (provider=$Provider)..."

  try {
    Invoke-PodmanCliWithTimeout -PodmanArgs @('machine', 'start') -TimeoutSeconds $CommandTimeoutSeconds
  } catch {
    if ($_.Exception.Message -match 'already running') {
      Write-Host 'Podman machine already running'
    } else {
      throw
    }
  }

  Invoke-PodmanCliWithTimeout -PodmanArgs @('info') -TimeoutSeconds $CommandTimeoutSeconds
  Write-Host 'Podman machine is reachable'
}

function Assert-PodmanMachineReady {
  param(
    [string]$Provider = 'wsl',
    [int]$CommandTimeoutSeconds = 180,
    [int]$MaxAttempts = 3
  )

  Initialize-PodmanEnvironment -Provider $Provider
  Write-Host "Verifying Podman machine readiness (provider=$Provider)..."

  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    Write-Host "Podman readiness check (attempt $attempt/$MaxAttempts)..."
    try {
      Invoke-PodmanCliWithTimeout -PodmanArgs @('machine', 'ls') -TimeoutSeconds $CommandTimeoutSeconds
      Invoke-PodmanCliWithTimeout -PodmanArgs @('info') -TimeoutSeconds $CommandTimeoutSeconds
      Write-Host 'Podman machine is ready'
      return
    } catch {
      Write-Host "Podman readiness attempt $attempt failed: $_"
      if ($attempt -eq $MaxAttempts) {
        throw
      }
      Restart-PodmanMachine -CommandTimeoutSeconds $CommandTimeoutSeconds
      Start-Sleep -Seconds (5 * $attempt)
    }
  }
}

function Write-KaidenBinaryPathFile {
  param(
    [Parameter(Mandatory)][string]$InstallDir,
    [Parameter(Mandatory)][string]$BinaryPath
  )

  if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  }

  $pathFile = Join-Path $InstallDir 'kaiden-binary-path.txt'
  Set-Content -Path $pathFile -Value $BinaryPath -NoNewline
  Write-Host "KAIDEN_BINARY=$BinaryPath"
  return $BinaryPath
}

function Get-KaidenE2EParamsPath {
  Join-Path $env:USERPROFILE 'ci-scripts\e2e-params.json'
}

function Get-KaidenE2EParams {
  $path = Get-KaidenE2EParamsPath
  if (-not (Test-Path $path)) {
    throw "E2E params file missing: $path"
  }

  return Get-Content $path -Raw | ConvertFrom-Json
}

function Assert-KaidenPrereleaseDownloadUrl {
  param(
    [Parameter(Mandatory)][string]$Url,
    [Parameter(Mandatory)][string]$Owner,
    [Parameter(Mandatory)][string]$Repo
  )

  $uri = [uri]$Url
  if ($uri.Scheme -ne 'https') {
    throw "Prerelease URL must use HTTPS: $Url"
  }

  if ($uri.Host -eq 'github.com') {
    $expectedPrefix = "/$Owner/$Repo/releases/download/"
    if (-not $uri.AbsolutePath.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Prerelease URL path must start with $expectedPrefix"
    }
    if ($uri.AbsolutePath -notmatch '\.(exe|msi)$') {
      throw 'Prerelease URL must end with .exe or .msi'
    }
    return
  }

  if ($uri.Host -eq 'objects.githubusercontent.com') {
    if ($Url -notmatch '\.(exe|msi)(\?|$)') {
      throw 'objects.githubusercontent.com URL must reference an .exe or .msi asset'
    }
    return
  }

  throw "Prerelease URL host not allowed: $($uri.Host)"
}

function Assert-KaidenPodmanDownloadUrl {
  param(
    [Parameter(Mandatory)][string]$Url
  )

  $uri = [uri]$Url
  if ($uri.Scheme -ne 'https') {
    throw "Podman URL must use HTTPS: $Url"
  }

  $allowedHosts = @('github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com')
  if ($allowedHosts -notcontains $uri.Host) {
    throw "Podman URL host not allowed: $($uri.Host)"
  }
}

function Import-KaidenWorkspaceSecrets {
  param(
    [string]$SecretsFileName = 'secrets.txt'
  )

  $secretsFile = Join-Path $env:USERPROFILE $SecretsFileName
  if (-not (Test-Path $secretsFile)) {
    return
  }

  Get-Content $secretsFile | ForEach-Object {
    if (-not $_.StartsWith('#') -and -not [string]::IsNullOrWhiteSpace($_)) {
      $key, $value = $_ -split '=', 2
      Set-Item -Path "env:$($key.Trim())" -Value $value.Trim()
    }
  }
}

function Get-RequiredWorkspaceTestEnvVars {
  param(
    [Parameter(Mandatory)][string]$NpmTarget
  )

  switch ($NpmTarget) {
    'test:e2e:workspaces:claude' { return @('ANTHROPIC_API_KEY') }
    'test:e2e:workspaces:goose' { return @('OPENAI_API_KEY', 'MISTRAL_API_KEY') }
    'test:e2e:workspaces:opencode' { return @('OPENAI_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'MISTRAL_API_KEY') }
    'test:e2e:workspaces:openclaw' { return @('OPENAI_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'MISTRAL_API_KEY') }
    'test:e2e:workspaces:run' { return @('ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'MISTRAL_API_KEY') }
    default { return @('ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'MISTRAL_API_KEY') }
  }
}

function Assert-RequiredWorkspaceTestEnv {
  param(
    [Parameter(Mandatory)][string]$NpmTarget
  )

  $secretsFile = Join-Path $env:USERPROFILE 'secrets.txt'
  if (-not (Test-Path $secretsFile)) {
    throw "secrets.txt missing at $secretsFile - upload secrets before running tests"
  }

  if ($env:PODMAN_ENABLED -ne 'true') {
    throw 'PODMAN_ENABLED must be true for Windows workspace E2E (set via workflow env_vars)'
  }

  if (-not $env:WORKSPACE_TESTS_CI) {
    throw 'WORKSPACE_TESTS_CI must be set for MAPT workspace E2E runs'
  }

  foreach ($var in (Get-RequiredWorkspaceTestEnvVars -NpmTarget $NpmTarget)) {
    if ([string]::IsNullOrWhiteSpace((Get-Item -Path "env:$var" -ErrorAction SilentlyContinue).Value)) {
      throw "${var} is not set - workspace tests will be skipped"
    }
    Write-Host "${var}=<set>"
  }

  Write-Host "PODMAN_ENABLED=$env:PODMAN_ENABLED WORKSPACE_TESTS_CI=$env:WORKSPACE_TESTS_CI"
}

function Clear-KaidenWorkspaceSecrets {
  param(
    [string[]]$SecretFileNames = @('secrets.txt', 'install-secrets.txt')
  )

  foreach ($name in $SecretFileNames) {
    $path = Join-Path $env:USERPROFILE $name
    if (Test-Path $path) {
      Remove-Item $path -Force
    }
  }
}

function Apply-KaidenAllowedEnvFromParams {
  param(
    [Parameter(Mandatory)]$Params
  )

  $env:CI = 'true'

  if ($Params.podmanProvider) {
    $env:CONTAINERS_MACHINE_PROVIDER = [string]$Params.podmanProvider
  }

  if ($Params.allowedEnv) {
    foreach ($prop in $Params.allowedEnv.PSObject.Properties) {
      Set-Item -Path "env:$($prop.Name)" -Value [string]$prop.Value
    }
  }
}

function Install-GitForWindows {
  if (Get-Command git -ErrorAction SilentlyContinue) {
    Write-Host "Git already installed: $(git version)"
    return
  }

  $ProgressPreference = 'SilentlyContinue'
  $gitVersion = '2.42.0.2'
  $toolsDir = Join-Path $env:USERPROFILE 'tools'
  if (-not (Test-Path $toolsDir)) {
    New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
  }

  $gitDir = Join-Path $toolsDir 'git'
  if (-not (Test-Path $gitDir)) {
    Invoke-DownloadWithRetry `
      -Uri "https://github.com/git-for-windows/git/releases/download/v2.42.0.windows.2/MinGit-$gitVersion-64-bit.zip" `
      -OutFile (Join-Path $toolsDir 'git.zip') `
      -MinBytes 1000000
    Expand-Archive -Path (Join-Path $toolsDir 'git.zip') -DestinationPath $gitDir -Force
    Remove-Item (Join-Path $toolsDir 'git.zip') -Force
  }

  $env:PATH = "$gitDir\cmd;$env:PATH"
  [System.Environment]::SetEnvironmentVariable(
    'PATH',
    "$gitDir\cmd;$([System.Environment]::GetEnvironmentVariable('PATH', 'User'))",
    [System.EnvironmentVariableTarget]::User
  )

  git version
}

function Invoke-KaidenWorkspaceE2ERemoteStep {
  param(
    [Parameter(Mandatory)]
    [ValidateSet(
      'SetPodmanMachineDefaults',
      'InstallNode',
      'InstallGit',
      'CloneAndInstallDeps',
      'InstallPodman',
      'InitPodman',
      'InstallPrerelease',
      'RunE2ETests'
    )]
    [string]$Step
  )

  $params = Get-KaidenE2EParams

  switch ($Step) {
    'SetPodmanMachineDefaults' {
      Set-PodmanMachineDefaults
    }
    'InstallNode' {
      Install-KaidenNodeToolchain -NvmrcVersion $params.nvmrcVersion
    }
    'InstallGit' {
      Install-GitForWindows
    }
    'CloneAndInstallDeps' {
      $workDir = Join-Path $env:USERPROFILE 'workspace'
      if (-not (Test-Path $workDir)) {
        New-Item -ItemType Directory -Path $workDir -Force | Out-Null
      }
      Set-Location $workDir

      $repo = [string]$params.repo
      $fork = [string]$params.fork
      $branch = [string]$params.branch

      if (-not (Test-Path $repo)) {
        Invoke-CommandWithRetry -Label 'Clone repository' -Action {
          git clone --branch $branch --single-branch "https://github.com/$fork/$repo.git"
        }
      } else {
        Write-Host 'Repo already cloned, fetching...'
        Set-Location $repo
        Invoke-CommandWithRetry -Label 'Fetch and checkout branch' -Action {
          git fetch --all
          git checkout $branch
          git pull --ff-only origin $branch
        }
        Set-Location $workDir
      }

      Install-KaidenPlaywrightTestDependencies -RepoDir (Join-Path $workDir $repo)
    }
    'InstallPodman' {
      $podmanUrl = [string]$params.podmanDownloadUrl
      if ([string]::IsNullOrWhiteSpace($podmanUrl)) {
        throw 'podmanDownloadUrl missing from e2e-params.json'
      }
      Assert-KaidenPodmanDownloadUrl -Url $podmanUrl
      Install-PodmanCli -PodmanDownloadUrl $podmanUrl
    }
    'InitPodman' {
      Initialize-AndStartPodmanMachine -Provider ([string]$params.podmanProvider)
    }
    'InstallPrerelease' {
      Import-KaidenWorkspaceSecrets -SecretsFileName 'install-secrets.txt'
      $installDir = Join-Path $env:USERPROFILE 'tools\kaiden'
      $token = $env:PRERELEASE_TOKEN
      if ([string]::IsNullOrWhiteSpace($token)) {
        $token = ''
      }

      $installParams = @{
        Owner = [string]$params.prereleaseOwner
        Repo = [string]$params.prereleaseRepo
        InstallDir = $installDir
        InstallMode = [string]$params.prereleaseInstallMode
        Token = $token
      }

      $tag = [string]$params.prereleaseTag
      if (-not [string]::IsNullOrWhiteSpace($tag)) {
        $installParams.Tag = $tag
      }

      $downloadUrl = [string]$params.prereleaseDownloadUrl
      if (-not [string]::IsNullOrWhiteSpace($downloadUrl)) {
        Assert-KaidenPrereleaseDownloadUrl -Url $downloadUrl -Owner $installParams.Owner -Repo $installParams.Repo
        $installParams.DownloadUrl = $downloadUrl
      }

      Install-KaidenPrereleaseBinary @installParams
    }
    'RunE2ETests' {
      $repo = [string]$params.repo
      $workDir = Join-Path $env:USERPROFILE "workspace\$repo"
      Set-Location $workDir

      $userPath = [System.Environment]::GetEnvironmentVariable('PATH', 'User')
      if ($userPath) {
        $env:PATH = "$userPath;$env:PATH"
      }

      Apply-KaidenAllowedEnvFromParams -Params $params
      Import-KaidenWorkspaceSecrets -SecretsFileName 'secrets.txt'

      $kaidenPathFile = Join-Path $env:USERPROFILE 'tools\kaiden\kaiden-binary-path.txt'
      if (-not (Test-Path $kaidenPathFile)) {
        throw "Kaiden binary path file not found at $kaidenPathFile"
      }

      $env:KAIDEN_BINARY = (Get-Content $kaidenPathFile -Raw).Trim()
      if (-not (Test-Path $env:KAIDEN_BINARY)) {
        throw "Kaiden binary not found at $env:KAIDEN_BINARY"
      }
      Write-Host "KAIDEN_BINARY=$env:KAIDEN_BINARY"

      $npmTarget = [string]$params.npmTarget
      if ($npmTarget -eq 'test:e2e:workspaces') {
        Write-Host 'Prerelease mode: running test:e2e:workspaces:run (skip dev app build)'
        $npmTarget = 'test:e2e:workspaces:run'
      }

      Write-Host "Running: pnpm $npmTarget"
      Write-Host "Provider: $env:CONTAINERS_MACHINE_PROVIDER"
      Write-Host "Working dir: $workDir"

      Assert-RequiredWorkspaceTestEnv -NpmTarget $npmTarget

      Prepare-WindowsDesktopForE2E -Provider $env:CONTAINERS_MACHINE_PROVIDER

      $recordingDir = Join-Path $workDir 'tests\playwright\output\screen-recordings'
      $recordingStarted = $false
      try {
        Start-E2EScreenRecording -OutputDir $recordingDir
        $recordingStarted = $true
        pnpm $npmTarget
        if ($LASTEXITCODE -ne 0) {
          throw "pnpm $npmTarget failed with exit code $LASTEXITCODE"
        }
      } finally {
        if ($recordingStarted) {
          Stop-E2EScreenRecording -OutputDir $recordingDir | Out-Null
        }
        Clear-KaidenWorkspaceSecrets
      }
    }
    default {
      throw "Unhandled remote step: $Step"
    }
  }
}

function Install-KaidenPrereleaseBinary {
  param(
    [Parameter(Mandatory)][string]$Owner,
    [Parameter(Mandatory)][string]$Repo,
    [Parameter(Mandatory)][string]$InstallDir,
    [ValidateSet('setup', 'portable')]
    [string]$InstallMode = 'setup',
    [string]$Tag = '',
    [string]$Token = '',
    [string]$DownloadUrl = ''
  )

  $headers = @{}
  if ($Token) {
    $headers['Authorization'] = "Bearer $Token"
  }

  if ($DownloadUrl) {
    Assert-KaidenPrereleaseDownloadUrl -Url $DownloadUrl -Owner $Owner -Repo $Repo
    Write-Host "Using pre-resolved download URL from workflow runner (mode=$InstallMode)"
    $fileName = [System.IO.Path]::GetFileName(([uri]$DownloadUrl).LocalPath)
    if (-not $fileName) {
      $fileName = if ($InstallMode -eq 'setup') { 'kaiden-setup-x64.exe' } else { 'kaiden-portable-x64.exe' }
    }
  } else {
    $releasesUrl = "https://api.github.com/repos/$Owner/$Repo/releases"
    if ($Tag) {
      Write-Host "Resolving prerelease tag $Tag from $Owner/$Repo..."
      $release = Invoke-RestMethod -Uri "$releasesUrl/tags/$Tag" -Headers (@{ 'User-Agent' = 'kaiden-workspace-e2e' } + $headers)
    } else {
      Write-Host "Resolving latest prerelease from $Owner/$Repo..."
      $releases = Invoke-RestMethod -Uri $releasesUrl -Headers (@{ 'User-Agent' = 'kaiden-workspace-e2e' } + $headers)
      if ($Token) {
        $release = $releases | Select-Object -First 1
      } else {
        $release = $releases | Where-Object { -not $_.draft } | Select-Object -First 1
      }
      if (-not $release) {
        throw "No release found in $Owner/$Repo"
      }
    }

    Write-Host "Using release $($release.tag_name) (draft=$($release.draft), mode=$InstallMode)"
    $asset = Select-KaidenReleaseAsset -Release $release -InstallMode $InstallMode

    if (-not $asset) {
      $names = ($release.assets | ForEach-Object { $_.name }) -join ', '
      throw "No Windows $InstallMode x64 asset on $($release.tag_name). Assets: $names"
    }

    $DownloadUrl = $asset.browser_download_url
    $fileName = $asset.name
  }

  if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  }

  $outFile = Join-Path $InstallDir $fileName
  Invoke-DownloadWithRetry -Uri $DownloadUrl -OutFile $outFile -MinBytes 10000000 -Headers $headers

  if ($InstallMode -eq 'setup') {
    Invoke-NsisInstallWithRetry -SetupPath $outFile
    $binaryPath = Resolve-KaidenInstalledBinary
  } else {
    $binaryPath = (Resolve-Path $outFile).Path
  }

  Enable-KaidenFirewallAccess -BinaryPath $binaryPath
  return Write-KaidenBinaryPathFile -InstallDir $InstallDir -BinaryPath $binaryPath
}

function Invoke-KaidenStartupProbe {
  param(
    [Parameter(Mandatory)][string]$BinaryPath,
    [int]$DurationSeconds = 30
  )

  $probeDir = Join-Path $env:TEMP 'kaiden-startup-probe'
  if (-not (Test-Path $probeDir)) {
    New-Item -ItemType Directory -Path $probeDir -Force | Out-Null
  }

  $stdoutFile = Join-Path $probeDir 'stdout.log'
  $stderrFile = Join-Path $probeDir 'stderr.log'
  $metaFile = Join-Path $probeDir 'meta.log'

  $installRoot = Split-Path $BinaryPath -Parent
  $indexHtml = Get-ChildItem -Path $installRoot -Recurse -Filter 'index.html' -ErrorAction SilentlyContinue |
    Select-Object -First 5 -ExpandProperty FullName

  @(
    "binary=$BinaryPath"
    "binaryExists=$(Test-Path $BinaryPath)"
    "installRoot=$installRoot"
    "indexHtmlMatches=$($indexHtml -join ';')"
    "os=$([System.Environment]::OSVersion.VersionString)"
    "user=$env:USERNAME"
    "session=$env:SESSIONNAME"
  ) | Set-Content -Path $metaFile

  Write-Host "=== Kaiden startup probe (direct launch ${DurationSeconds}s) ==="
  Get-Content $metaFile | ForEach-Object { Write-Host $_ }

  $args = @('--disable-gpu', '--disable-gpu-compositing', '--force-device-scale-factor=1', '--use-gl=swiftshader')
  $proc = Start-Process -FilePath $BinaryPath -ArgumentList $args `
    -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile -PassThru
  Write-Host "Probe pid=$($proc.Id)"
  Start-Sleep -Seconds $DurationSeconds

  if (-not $proc.HasExited) {
    Write-Host "Probe process still running after ${DurationSeconds}s, stopping..."
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  } else {
    Write-Host "Probe process exited early with code $($proc.ExitCode)"
  }

  Write-Host '--- probe stderr ---'
  if (Test-Path $stderrFile) { Get-Content $stderrFile | ForEach-Object { Write-Host $_ } }
  Write-Host '--- probe stdout ---'
  if (Test-Path $stdoutFile) { Get-Content $stdoutFile | ForEach-Object { Write-Host $_ } }
  Write-Host '=== end startup probe ==='
}

$script:E2EFfmpegZipName = 'ffmpeg-n7.1-latest-win64-gpl-7.1.zip'
$script:E2EFfmpegDownloadUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/$($script:E2EFfmpegZipName)"

function Resolve-E2EFfmpegExecutable {
  $toolsDir = Join-Path $env:USERPROFILE 'tools\ffmpeg'
  $cachedExe = Join-Path $toolsDir 'bin\ffmpeg.exe'
  if (Test-Path $cachedExe) {
    return $cachedExe
  }

  if (-not (Test-Path $toolsDir)) {
    New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
  }

  $zipPath = Join-Path $toolsDir $script:E2EFfmpegZipName
  Write-Host "Downloading portable ffmpeg from $($script:E2EFfmpegDownloadUrl)..."
  Invoke-DownloadWithRetry -Uri $script:E2EFfmpegDownloadUrl -OutFile $zipPath -MinBytes 50000000

  $extractDir = Join-Path $toolsDir 'extract'
  if (Test-Path $extractDir) {
    Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

  $ffmpegMatch = Get-ChildItem -Path $extractDir -Recurse -Filter 'ffmpeg.exe' -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $ffmpegMatch) {
    throw "ffmpeg.exe not found after extracting $zipPath"
  }

  $binDir = Join-Path $toolsDir 'bin'
  if (-not (Test-Path $binDir)) {
    New-Item -ItemType Directory -Path $binDir -Force | Out-Null
  }
  Copy-Item -Path $ffmpegMatch.FullName -Destination $cachedExe -Force
  Write-Host "Installed ffmpeg at $cachedExe"
  return $cachedExe
}

function Start-E2EScreenRecording {
  param(
    [Parameter(Mandatory)][string]$OutputDir,
    [string]$OutputFileName = 'e2e-screen-recording.mp4',
    [int]$FrameRate = 15
  )

  $ffmpeg = Resolve-E2EFfmpegExecutable
  if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
  }

  $outputPath = Join-Path $OutputDir $OutputFileName
  $metaFile = Join-Path $OutputDir 'screen-recording.meta.json'
  $logFile = Join-Path $OutputDir 'screen-recording.log'

  if (Test-Path $outputPath) {
    Remove-Item $outputPath -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path $logFile) {
    Remove-Item $logFile -Force -ErrorAction SilentlyContinue
  }

  $ffmpegArgs = @(
    '-hide_banner', '-loglevel', 'warning',
    '-f', 'gdigrab',
    '-framerate', "$FrameRate",
    '-draw_mouse', '1',
    '-i', 'desktop',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-y', $outputPath
  )

  $proc = Start-Process -FilePath $ffmpeg -ArgumentList $ffmpegArgs `
    -RedirectStandardError $logFile -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 2

  if ($proc.HasExited) {
    if (Test-Path $logFile) {
      Write-Host '--- ffmpeg startup log ---'
      Get-Content $logFile | ForEach-Object { Write-Host $_ }
    }
    throw "ffmpeg exited early with code $($proc.ExitCode)"
  }

  @{
    pid = $proc.Id
    outputPath = $outputPath
    logFile = $logFile
    startedAt = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json | Set-Content -Path $metaFile

  Write-Host "Screen recording started pid=$($proc.Id) -> $outputPath"
}

function Prepare-WindowsDesktopForE2E {
  param(
    [string]$Provider = 'wsl'
  )

  Dismiss-WindowsShellOverlays
  Ensure-PodmanMachineRunning -Provider $Provider
  Dismiss-WindowsShellOverlays
}

function Stop-E2EScreenRecording {
  param(
    [Parameter(Mandatory)][string]$OutputDir,
    [int]$GraceSeconds = 15
  )

  $metaFile = Join-Path $OutputDir 'screen-recording.meta.json'
  if (-not (Test-Path $metaFile)) {
    Write-Host 'Screen recording meta file not found, skipping stop'
    return $null
  }

  $meta = Get-Content $metaFile -Raw | ConvertFrom-Json
  $proc = Get-Process -Id $meta.pid -ErrorAction SilentlyContinue
  if ($proc) {
    Write-Host "Stopping screen recording pid=$($meta.pid)..."
    Stop-Process -Id $meta.pid -Force -ErrorAction SilentlyContinue
    $deadline = (Get-Date).AddSeconds($GraceSeconds)
    while ((Get-Date) -lt $deadline) {
      if (-not (Get-Process -Id $meta.pid -ErrorAction SilentlyContinue)) {
        break
      }
      Start-Sleep -Milliseconds 250
    }
  } else {
    Write-Host "Screen recording process $($meta.pid) is not running"
  }

  $outputPath = $meta.outputPath
  if (Test-Path $outputPath) {
    $size = (Get-Item $outputPath).Length
    Write-Host "Screen recording saved: $outputPath ($size bytes)"
  } else {
    Write-Host "Screen recording output missing: $outputPath"
    if (Test-Path $meta.logFile) {
      Write-Host '--- ffmpeg log ---'
      Get-Content $meta.logFile | ForEach-Object { Write-Host $_ }
    }
  }

  Remove-Item $metaFile -Force -ErrorAction SilentlyContinue
  return $outputPath
}

function Resolve-NodeVersionLabel {
  param(
    [Parameter(Mandatory)][string]$NvmrcVersion
  )

  $version = $NvmrcVersion.Trim() -replace '^v', ''
  if ([string]::IsNullOrWhiteSpace($version)) {
    throw 'Node version from .nvmrc is empty'
  }

  return "v$version"
}

function Install-KaidenNodeToolchain {
  param(
    [Parameter(Mandatory)][string]$NvmrcVersion
  )

  $NodeVersionLabel = Resolve-NodeVersionLabel -NvmrcVersion $NvmrcVersion
  $ProgressPreference = 'SilentlyContinue'
  $toolsDir = Join-Path $env:USERPROFILE 'tools'
  if (-not (Test-Path $toolsDir)) {
    New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
  }

  $nodeDir = "$toolsDir\node-$NodeVersionLabel-win-x64"
  if (-not (Test-Path $nodeDir)) {
    Invoke-DownloadWithRetry `
      -Uri "https://nodejs.org/dist/$NodeVersionLabel/node-$NodeVersionLabel-win-x64.zip" `
      -OutFile "$toolsDir\nodejs.zip" `
      -MinBytes 1000000
    Expand-Archive -Path "$toolsDir\nodejs.zip" -DestinationPath $toolsDir -Force
    Remove-Item "$toolsDir\nodejs.zip" -Force
  }

  $env:PATH = "$nodeDir;$env:PATH"
  [System.Environment]::SetEnvironmentVariable(
    'PATH',
    "$nodeDir;$([System.Environment]::GetEnvironmentVariable('PATH', 'User'))",
    [System.EnvironmentVariableTarget]::User
  )

  Write-Host "Using Node $NodeVersionLabel from .nvmrc"
  node -v
  npm -v

  Invoke-CommandWithRetry -Label 'Install pnpm' -Action { npm install -g pnpm@10 }
  pnpm --version
}

function Set-PodmanMachineDefaults {
  param(
    [int]$Cpus = 4,
    [int]$MemoryMb = 16384
  )

  $configDir = Join-Path $env:APPDATA 'containers'
  if (-not (Test-Path $configDir)) {
    New-Item -ItemType Directory -Path $configDir -Force | Out-Null
  }

  $conf = "[machine]`ncpus = $Cpus`nmemory = $MemoryMb`n"
  Set-Content -Path (Join-Path $configDir 'containers.conf') -Value $conf
  Write-Host "Podman machine defaults: $Cpus CPUs, ${MemoryMb}MB RAM"
}

function Resolve-PodmanExecutable {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Podman\podman.exe'),
    'C:\Program Files\RedHat\Podman\podman.exe'
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  throw 'podman.exe not found after install'
}

function Add-PodmanToPath {
  param(
    [Parameter(Mandatory)][string]$PodmanExe
  )

  $podmanBin = Split-Path $PodmanExe -Parent
  $env:PATH += ";$podmanBin"
  $currentUserPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
  if (-not $currentUserPath.Contains($podmanBin)) {
    [Environment]::SetEnvironmentVariable('PATH', ($currentUserPath + ';' + $podmanBin), 'User')
  }
}

function Install-PodmanCli {
  param(
    [Parameter(Mandatory)][string]$PodmanDownloadUrl
  )

  $ProgressPreference = 'SilentlyContinue'

  if (Get-Command podman -ErrorAction SilentlyContinue) {
    $existingExe = (Get-Command podman).Source
    Write-Host "Podman already installed at: $existingExe"
    return
  }

  $toolsDir = Join-Path $env:USERPROFILE 'tools'
  if (-not (Test-Path $toolsDir)) {
    New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
  }

  $msiPath = Join-Path $toolsDir 'podman.msi'
  Invoke-DownloadWithRetry -Uri $PodmanDownloadUrl -OutFile $msiPath -MinBytes 1000000
  Invoke-MsiInstallWithRetry -MsiPath $msiPath

  $podmanExe = Resolve-PodmanExecutable
  Add-PodmanToPath -PodmanExe $podmanExe
  # Avoid running podman.exe here - first launch can hang on WSL/machine setup and block SSH.
  Write-Host "Podman installed at: $podmanExe"
}

function Initialize-AndStartPodmanMachine {
  param(
    [string]$Provider = 'wsl'
  )

  $userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
  if ($userPath) {
    $env:PATH = "$userPath;$env:PATH"
  }

  if (-not (Get-Command podman -ErrorAction SilentlyContinue)) {
    $podmanExe = Resolve-PodmanExecutable
    Add-PodmanToPath -PodmanExe $podmanExe
  }

  $env:CONTAINERS_MACHINE_PROVIDER = $Provider
  Write-Host "Provider: $env:CONTAINERS_MACHINE_PROVIDER"
  Write-Host "User: $(whoami)"

  $existingMachines = podman machine ls --format '{{.Name}}' 2>$null
  if ($existingMachines) {
    Write-Host "Podman machine already exists: $existingMachines"
  } else {
    Invoke-CommandWithRetry -Label 'podman machine init' -Action { podman machine init --rootful }
  }

  Invoke-CommandWithRetry -Label 'podman machine start' -Action {
    podman machine start
    if ($LASTEXITCODE -eq 125) {
      Write-Host 'Podman machine already running, continuing'
      return
    }
    if ($LASTEXITCODE -ne 0) {
      throw "podman machine start failed with exit code $LASTEXITCODE"
    }
  }
  Enable-PodmanFirewallAccess
  Assert-PodmanMachineReady -Provider $Provider
}

function Install-KaidenPlaywrightTestDependencies {
  param(
    [Parameter(Mandatory)][string]$RepoDir
  )

  Push-Location $RepoDir
  try {
    $userPath = [System.Environment]::GetEnvironmentVariable('PATH', 'User')
    if ($userPath) {
      $env:PATH = "$userPath;$env:PATH"
    }

    Write-Host 'Installing Playwright test dependencies (prerelease mode, no app build)...'
    Invoke-CommandWithRetry -Label 'pnpm install playwright workspace' -Action {
      pnpm install --filter @openkaiden/tests-playwright... --ignore-scripts
    }

    Invoke-CommandWithRetry -Label 'playwright install chromium' -Action {
      pnpm exec playwright install chromium
    }
  } finally {
    Pop-Location
  }
}
