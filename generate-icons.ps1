Add-Type -AssemblyName System.Drawing

function New-AppIcon {
    param(
        [int]$Size,
        [string]$OutPath,
        [bool]$FullBleed
    )

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    $bgColor = [System.Drawing.ColorTranslator]::FromHtml('#6366f1')
    $bgBrush = New-Object System.Drawing.SolidBrush($bgColor)

    if ($FullBleed) {
        $g.FillRectangle($bgBrush, 0, 0, $Size, $Size)
        $fontSize = $Size * 0.34
    } else {
        $radius = [int]($Size * 0.2)
        $d = $radius * 2
        $path = New-Object System.Drawing.Drawing2D.GraphicsPath
        $path.AddArc(0, 0, $d, $d, 180, 90)
        $path.AddArc($Size - $d, 0, $d, $d, 270, 90)
        $path.AddArc($Size - $d, $Size - $d, $d, $d, 0, 90)
        $path.AddArc(0, $Size - $d, $d, $d, 90, 90)
        $path.CloseFigure()
        $g.FillPath($bgBrush, $path)
        $fontSize = $Size * 0.5
    }

    $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $font = New-Object System.Drawing.Font('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center

    $rect = New-Object System.Drawing.RectangleF(0, 0, $Size, $Size)
    $g.DrawString('P', $font, $textBrush, $rect, $sf)

    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    $font.Dispose()
}

$dir = Join-Path $PSScriptRoot 'icons'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

New-AppIcon -Size 192 -OutPath (Join-Path $dir 'icon-192.png') -FullBleed $false
New-AppIcon -Size 512 -OutPath (Join-Path $dir 'icon-512.png') -FullBleed $false
New-AppIcon -Size 192 -OutPath (Join-Path $dir 'icon-maskable-192.png') -FullBleed $true
New-AppIcon -Size 512 -OutPath (Join-Path $dir 'icon-maskable-512.png') -FullBleed $true
New-AppIcon -Size 180 -OutPath (Join-Path $dir 'icon-180.png') -FullBleed $true

Write-Output "Icons generated in $dir"
