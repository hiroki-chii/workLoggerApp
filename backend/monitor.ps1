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

# アイドル時間の取得
$idleSeconds = 0
try {
    $lastInput = New-Object Win32+LASTINPUTINFO
    $lastInput.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf([Type][Win32+LASTINPUTINFO])
    if ([Win32]::GetLastInputInfo([ref]$lastInput)) {
        $idleTicks = [Environment]::TickCount - $lastInput.dwTime
        $idleSeconds = [Math]::Max(0, $idleTicks / 1000)
    }
} catch { }

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

# 第2の手法: フォールバック (Get-Process)
# 第1の手法で検知できなかった場合、メインウィンドウタイトルを持つプロセスから推測
if ($appName -eq "None") {
    try {
        # メインウィンドウハンドルを持ち、かつタイトルがあるプロセスを取得
        $activeProcesses = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle }
        if ($activeProcesses) {
            # 最も最近アクティブだったものを特定するのは困難だが、
            # 最初に見つかった「有効な」ウィンドウを持つプロセスをフォールバックに採用
            $fallback = $activeProcesses | Select-Object -First 1
            $appName = $fallback.ProcessName
            $title = $fallback.MainWindowTitle
        }
    } catch { }
}

$result = @{
    appName = $appName
    windowTitle = $title
    idleSeconds = $idleSeconds
    timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss")
}

$result | ConvertTo-Json
