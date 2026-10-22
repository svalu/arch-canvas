# PowerPoint COM 검증: EXE --scene 모드로 장면을 클립보드에 올리고, 새 프레젠테이션(저장 안 함)에 붙여서 도형을 측정한다.
# 사용: powershell -STA -File tools\verify_ppt.ps1 -Scene _dev\scene_3tier.json [-Exe path]
# 열려 있는 다른 프레젠테이션은 건드리지 않는다. PowerPoint 가 안 떠 있으면 새로 띄우고 끝나면 닫는다.
param(
    [Parameter(Mandatory)][string]$Scene,
    [string]$Exe,
    [string]$Gvml,
    [string]$Png,     # 주면 붙여넣은 슬라이드를 PNG 로 내보낸다(눈으로 확인용)
    [switch]$FromClipboard   # EXE 를 돌리지 않고 지금 클립보드 내용을 검사(앱 UI 에서 복사한 뒤 사용). Scene 은 기대값 계산용.
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$root = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
if (-not $Exe) { $Exe = Join-Path $root 'release\Arch_Canvas_v0.1.0\Arch Canvas.exe' }
if (-not $Gvml) { $Gvml = Join-Path $root '_dev\last.gvml.zip' }

$Scene = (Resolve-Path $Scene).Path
if (-not $FromClipboard) {
    $Exe = (Resolve-Path $Exe).Path
    $p = Start-Process -FilePath $Exe -ArgumentList @('--scene', "`"$Scene`"", '--gvml', "`"$Gvml`"") -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "EXE --scene 실패 (exit $($p.ExitCode)): " + (Get-Content (Join-Path $env:TEMP 'ArchCanvas_scene_error.txt') -Raw) }
}
$fmts = [Windows.Forms.Clipboard]::GetDataObject().GetFormats()
if ($fmts -notcontains 'Art::GVML ClipFormat') { throw "클립보드에 GVML 없음: $($fmts -join ', ')" }
"clipboard: " + ($fmts -join ', ')

$expected = Get-Content $Scene -Raw -Encoding UTF8 | ConvertFrom-Json
$exp = @{ rect = 0; pic = 0; text = 0; cxn = 0 }
foreach ($s in $expected.shapes) { $exp[$s.t]++ }
"expected: rect=$($exp.rect) pic=$($exp.pic) text=$($exp.text) cxn=$($exp.cxn)  size=$([math]::Round($expected.width/360000,2))x$([math]::Round($expected.height/360000,2))cm"

$started = $false
try { $pp = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application') }
catch { $pp = New-Object -ComObject PowerPoint.Application; $started = $true }
$before = $pp.Presentations.Count
$pres = $pp.Presentations.Add(0)   # WithWindow = false
try {
    # 장면이 슬라이드보다 커도 다 보이게 슬라이드를 장면보다 조금 크게
    $pres.PageSetup.SlideWidth = [math]::Max(960, $expected.width / 12700 + 80)
    $pres.PageSetup.SlideHeight = [math]::Max(540, $expected.height / 12700 + 80)
    $sl = $pres.Slides.Add(1, 12)  # ppLayoutBlank
    $sl.Shapes.Paste() | Out-Null
    if ($Png) { $sl.Export((Join-Path (Resolve-Path (Split-Path $Png -Parent)).Path (Split-Path $Png -Leaf)), 'PNG', 1800, [int](1800 * $pres.PageSetup.SlideHeight / $pres.PageSetup.SlideWidth)); "png: $Png" }
    $n = $sl.Shapes.Count
    "pasted shapes: $n"
    $cm = 28.3465  # pt per cm
    $byType = @{}
    $rows = @()
    $connected = 0; $cxnTotal = 0; $svg = 0; $textOk = 0; $sizeBad = 0
    foreach ($sh in $sl.Shapes) {
        $t = [int]$sh.Type
        $byType[$t] = 1 + $(if ($byType.ContainsKey($t)) { $byType[$t] } else { 0 })
        $w = [math]::Round($sh.Width / $cm, 2); $h = [math]::Round($sh.Height / $cm, 2)
        $extra = ''
        if ($sh.Connector) {
            $cxnTotal++
            $cf = $sh.ConnectorFormat
            $b = [int]$cf.BeginConnected; $e = [int]$cf.EndConnected
            if ($b -eq -1 -and $e -eq -1) { $connected++ }
            $extra = "begin=$(if($b -eq -1){$cf.BeginConnectedShape.Name + '#' + $cf.BeginConnectionSite}else{'-'}) end=$(if($e -eq -1){$cf.EndConnectedShape.Name + '#' + $cf.EndConnectionSite}else{'-'}) rot=$($sh.Rotation) flipH=$([int]$sh.HorizontalFlip) flipV=$([int]$sh.VerticalFlip) dash=$([int]$sh.Line.DashStyle) head=$([int]$sh.Line.BeginArrowheadStyle) tail=$([int]$sh.Line.EndArrowheadStyle)"
        }
        elseif ($t -eq 13 -or $t -eq 28) {   # msoPicture / msoGraphic(SVG)
            $svg++
            if ([math]::Abs($w - 1.5) -gt 0.02 -and [math]::Abs($w - 1.0) -gt 0.02) { $sizeBad++ }
        }
        elseif ($sh.HasTextFrame -eq -1) {
            $txt = $sh.TextFrame.TextRange.Text
            if ($txt) { $textOk++ }
            $extra = "text='" + $txt + "' line=" + [int]$sh.Line.Visible + " dash=" + [int]$sh.Line.DashStyle + " lineRGB=" + ('{0:X6}' -f [int]$sh.Line.ForeColor.RGB) + " fill=" + [int]$sh.Fill.Visible + " fillRGB=" + ('{0:X6}' -f [int]$sh.Fill.ForeColor.RGB)
        }
        $rows += ("{0,-34} type={1,-3} {2,6}x{3,-6}cm @({4},{5}) {6}" -f $sh.Name, $t, $w, $h, [math]::Round($sh.Left/$cm,2), [math]::Round($sh.Top/$cm,2), $extra)
    }
    $rows
    ""
    "by type: " + (($byType.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join ' ')
    "svg pictures: $svg (expected $($exp.pic)); icon size mismatch: $sizeBad"
    "connectors: $cxnTotal (expected $($exp.cxn)); both ends connected: $connected"
    "shapes with text: $textOk"
    $ok = ($n -eq ($exp.rect + $exp.pic + $exp.text + $exp.cxn)) -and ($cxnTotal -eq $exp.cxn) -and ($connected -eq $exp.cxn) -and ($svg -eq $exp.pic) -and ($sizeBad -eq 0)
    "RESULT: " + $(if ($ok) { 'PASS' } else { 'FAIL' })
}
finally {
    $pres.Saved = -1   # 저장 여부 묻지 않게
    $pres.Close()
    if ($started) { $pp.Quit() }
    [Runtime.InteropServices.Marshal]::ReleaseComObject($pres) | Out-Null
}
