# Signs one Windows file with DigUp's code signing identity (Authenticode, SHA-256, timestamped), so Windows and
# SmartScreen name its publisher instead of "Unknown publisher". Tauri runs it on DigUp.exe, the installer and its
# uninstaller (bundle.windows.signCommand, set by scripts/package-windows.sh), and package-windows.sh on the helper's
# programs. Either identity, from the environment (the packages workflow fills it from the repository's secrets):
#   a certificate file: WINDOWS_CERTIFICATE (the .pfx, base64) and WINDOWS_CERTIFICATE_PASSWORD
#   Azure Artifact Signing (formerly Trusted Signing): AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET for an app
#     with the "Artifact Signing Certificate Profile Signer" role, and AZURE_SIGNING_ENDPOINT (like
#     https://eus.codesigning.azure.net), AZURE_SIGNING_ACCOUNT, AZURE_SIGNING_PROFILE
#   pwsh -File scripts/sign-windows.ps1 <file>
param([Parameter(Mandatory = $true)][string]$File)
$ErrorActionPreference = "Stop"

# signtool from the newest Windows SDK (the runner has it; so does Visual Studio's C++ workload).
$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
  Sort-Object { [version]($_.Directory.Parent.Name) } | Select-Object -Last 1
if (-not $signtool) { throw "no signtool.exe: install the Windows SDK" }

$work = Join-Path ([IO.Path]::GetTempPath()) "digup-signing"
New-Item -ItemType Directory -Force $work | Out-Null

if ($env:WINDOWS_CERTIFICATE) {
  $pfx = Join-Path $work "certificate.pfx"
  if (-not (Test-Path $pfx)) { [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:WINDOWS_CERTIFICATE)) }
  & $signtool.FullName sign /fd SHA256 /f $pfx /p $env:WINDOWS_CERTIFICATE_PASSWORD /tr http://timestamp.digicert.com /td SHA256 $File
} elseif ($env:AZURE_SIGNING_ACCOUNT) {
  # Microsoft's signtool plug-in for Artifact Signing, fetched once per run, and what it signs with.
  $client = Join-Path $work "client"
  $dlib = Get-ChildItem "$client\bin\x64\Azure.CodeSigning.Dlib.dll" -ErrorAction SilentlyContinue
  if (-not $dlib) {
    $package = Join-Path $work "client.zip"
    Invoke-WebRequest "https://www.nuget.org/api/v2/package/Microsoft.ArtifactSigning.Client/1.0.146" -OutFile $package
    if ((Get-FileHash $package -Algorithm SHA256).Hash -ne "7761E5D8F31E54B764DA21D33CD8B0A2940E1B05526C7DFCB5E94B0431426F70") {
      throw "the Artifact Signing client isn't the one expected"
    }
    Expand-Archive $package $client -Force
    $dlib = Get-ChildItem "$client\bin\x64\Azure.CodeSigning.Dlib.dll"
  }
  $metadata = Join-Path $work "metadata.json"
  @{ Endpoint = $env:AZURE_SIGNING_ENDPOINT; CodeSigningAccountName = $env:AZURE_SIGNING_ACCOUNT
     CertificateProfileName = $env:AZURE_SIGNING_PROFILE } | ConvertTo-Json | Set-Content $metadata
  & $signtool.FullName sign /v /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 /dlib $dlib.FullName /dmdf $metadata $File
} else {
  throw "no signing identity: set WINDOWS_CERTIFICATE or AZURE_SIGNING_ACCOUNT"
}
if ($LASTEXITCODE -ne 0) { throw "signtool failed on $File" }
