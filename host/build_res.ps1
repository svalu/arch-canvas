# Embedded resources: gzip each file into obj\ and write a csc response file with /resource lines.
# Resource names keep their relative path (app/index.html.gz, bin/WebView2Loader.dll.gz ...); Bootstrap.Extract() maps them back.
param([string]$Src, [string]$Obj, [string]$Out, [string]$Ver)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false

function Gzip-File([string]$inPath, [string]$name) {
    $gzPath = Join-Path $Obj ($name.Replace('/', '_') + '.gz')
    $in = [IO.File]::OpenRead($inPath)
    $outFs = [IO.File]::Create($gzPath)
    $gz = New-Object IO.Compression.GZipStream $outFs, ([IO.Compression.CompressionLevel]::Optimal)
    $in.CopyTo($gz); $gz.Dispose(); $outFs.Dispose(); $in.Dispose()
    return "/resource:`"$gzPath`",`"$name.gz`""
}

$lines = @()
$lines += Gzip-File (Join-Path $Src '..\dist\index.html') 'app/index.html'
foreach ($f in Get-ChildItem (Join-Path $Src 'lib') -File -Filter *.dll) { $lines += Gzip-File $f.FullName "bin/$($f.Name)" }
[IO.File]::WriteAllLines((Join-Path $Obj 'resources.rsp'), $lines, $utf8)

Copy-Item (Join-Path $Src '사용안내.txt') $Out -Force -ErrorAction SilentlyContinue
"resources: $($lines.Count) files -> $Obj"
