[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class Win32 {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [StructLayout(LayoutKind.Sequential)]
    public struct LASTINPUTINFO {
        public uint cbSize;
        public uint dwTime;
    }

    [DllImport("user32.dll")]
    public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
}
"@

# stdin EOF ends the helper when the collector exits. Add-Type runs once.
while ($null -ne ($request = [Console]::ReadLine())) {
    if ($request -ne 'sample') { continue }
    # アイドル時間の取得
    $idleSeconds = 0.0
    try {
        $lastInput = New-Object Win32+LASTINPUTINFO
        $lastInput.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf([Type][Win32+LASTINPUTINFO])
        if ([Win32]::GetLastInputInfo([ref]$lastInput)) {
            $idleTicks = [uint32][Environment]::TickCount - $lastInput.dwTime
            $idleSeconds = [Math]::Max(0.0, [double]$idleTicks / 1000.0)
        }
    } catch { $idleSeconds = 0.0 }

    # アクティブウィンドウの取得
    $title = ""
    $appName = "None"
    $hwnd = [Win32]::GetForegroundWindow()

    # 第1の手法: GetForegroundWindow
    if ($hwnd -ne [IntPtr]::Zero -and $hwnd -ne 0) {
        try {
            $sb = New-Object System.Text.StringBuilder 256
            if ([Win32]::GetWindowText($hwnd, $sb, $sb.Capacity) -ne 0) {
                $title = $sb.ToString()
            }

            $processId = 0
            [Win32]::GetWindowThreadProcessId($hwnd, [ref]$processId) | Out-Null
            if ($processId -ne 0) {
                $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
                if ($process) {
                    $appName = $process.ProcessName
                }
            }
        } catch { }
    }

    $result = @{
        appName = $appName
        windowTitle = $title
        idleSeconds = $idleSeconds
        timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss")
    }

    $result | ConvertTo-Json -Compress
    [Console]::Out.Flush()
}
