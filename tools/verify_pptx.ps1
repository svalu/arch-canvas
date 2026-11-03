# .pptx 파일을 PowerPoint(COM)로 열어 슬라이드 1 의 도형을 세고, 장면 JSON 의 기대값과 맞춰 본다. PNG 를 주면 슬라이드를 그려 낸다.
# 사용: powershell -File tools\verify_pptx.ps1 -Path out.pptx -Scene scene.json [-Png out.png]
param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Scene,
    [string]$Png
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Web.Extensions
$ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$ser.MaxJsonLength = [int]::MaxValue
$expected = $ser.DeserializeObject((Get-Content -Raw -Encoding UTF8 $Scene))
$exp = @{ rect = 0; pic = 0; text = 0; cxn = 0 }
foreach ($s in $expected.shapes) { $exp[$s.t]++ }
"expected: rect=$($exp.rect) pic=$($exp.pic) text=$($exp.text) cxn=$($exp.cxn)  size=$([math]::Round($expected.width/360000,2))x$([math]::Round($expected.height/360000,2))cm"
$full = (Resolve-Path $Path).Path
$started = $false
try { $pp = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application') }
catch { $pp = New-Object -ComObject PowerPoint.Application; $started = $true }
$pres = $pp.Presentations.Open($full, $true, $true, $false)   # ReadOnly, Untitled, WithWindow=false
try {
    "slide size: $([math]::Round($pres.PageSetup.SlideWidth/28.3465,2))x$([math]::Round($pres.PageSetup.SlideHeight/28.3465,2))cm · slides: $($pres.Slides.Count)"
    $sl = $pres.Slides.Item(1)
    if ($Png) { $sl.Export((Join-Path (Resolve-Path (Split-Path $Png -Parent)).Path (Split-Path $Png -Leaf)), 'PNG', 1920, 1080); "png: $Png" }
    $top = $sl.Shapes.Count
    $cm = 28.3465
    $group = $null; $title = $null
    foreach ($sh in $sl.Shapes) { if ([int]$sh.Type -eq 6) { $group = $sh } elseif ($sh.HasTextFrame) { $title = $sh.TextFrame.TextRange.Text } }
    "top-level shapes: $top · title='$title'"
    if ($group -eq $null) { "RESULT: FAIL (no group)"; exit 1 }
    "group: $([math]::Round($group.Left/$cm,2)),$([math]::Round($group.Top/$cm,2)) $([math]::Round($group.Width/$cm,2))x$([math]::Round($group.Height/$cm,2))cm · items: $($group.GroupItems.Count)"
    $byType = @{}; $cxnTotal = 0; $connected = 0; $svg = 0; $withText = 0
    foreach ($sh in $group.GroupItems) {
        $t = [int]$sh.Type
        $byType[$t] = 1 + $(if ($byType.ContainsKey($t)) { $byType[$t] } else { 0 })
        if ($sh.Connector) { $cxnTotal++; $cf = $sh.ConnectorFormat; if ($cf.BeginConnected -and $cf.EndConnected) { $connected++ } }
        elseif ($t -eq 13 -or $t -eq 28) { $svg++ }
        if ($sh.HasTextFrame -and $sh.TextFrame.HasText) { $withText++ }
    }
    "by type: " + (($byType.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join ' ')
    "pictures: $svg (expected $($exp.pic)); connectors: $cxnTotal (expected $($exp.cxn)); both ends connected: $connected; shapes with text: $withText"
    $n = $group.GroupItems.Count
    $ok = ($n -eq ($exp.rect + $exp.pic + $exp.text + $exp.cxn)) -and ($cxnTotal -eq $exp.cxn) -and ($connected -eq $exp.cxn) -and ($svg -eq $exp.pic)
    if ($ok) { "RESULT: PASS" } else { "RESULT: FAIL" }
} finally {
    $pres.Close()
    if ($started) { $pp.Quit() }
}
