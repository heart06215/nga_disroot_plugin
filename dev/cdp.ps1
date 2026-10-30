param(
    [int]$Port = 9333,
    [string]$PageId,
    [string]$ExprFile,
    [string]$OutFile
)
$ErrorActionPreference = "Stop"
$src = @'
using System;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
public class CdpClient2
{
    private static string Esc(string s)
    {
        var sb = new StringBuilder();
        foreach (char c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 32) sb.Append("\\u" + ((int)c).ToString("x4"));
                    else sb.Append(c);
                    break;
            }
        }
        return sb.ToString();
    }
    public static string Eval(string wsUrl, string expression, int timeoutMs)
    {
        using (var ws = new ClientWebSocket())
        using (var cts = new CancellationTokenSource())
        {
            cts.CancelAfter(timeoutMs);
            if (!ws.ConnectAsync(new Uri(wsUrl), cts.Token).Wait(timeoutMs)) return "TIMEOUT_CONNECT";
            string payload = "{\"id\":1,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":\"" + Esc(expression) + "\",\"returnByValue\":true}}";
            byte[] bytes = Encoding.UTF8.GetBytes(payload);
            if (!ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, cts.Token).Wait(timeoutMs)) return "TIMEOUT_SEND";
            var buf = new byte[1 << 20];
            var sb = new StringBuilder();
            while (true)
            {
                var recv = ws.ReceiveAsync(new ArraySegment<byte>(buf), cts.Token);
                if (!recv.Wait(timeoutMs)) return "TIMEOUT_RECV";
                var r = recv.Result;
                sb.Append(Encoding.UTF8.GetString(buf, 0, r.Count));
                if (r.EndOfMessage) break;
            }
            try { ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "done", CancellationToken.None).Wait(2000); } catch { }
            return sb.ToString();
        }
    }
}
'@
Add-Type -TypeDefinition $src -Language CSharp

$expr = Get-Content $ExprFile -Raw -Encoding UTF8
$url = "ws://127.0.0.1:$Port/devtools/page/$PageId"
$raw = [CdpClient2]::Eval($url, $expr, 25000)
if ($raw.StartsWith("TIMEOUT_")) { Write-Output $raw; exit 1 }

$result = $raw
try {
    $j = $raw | ConvertFrom-Json
    if ($j.result -and $j.result.result -and $null -ne $j.result.result.value) { $result = [string]$j.result.result.value }
} catch { }

if ($OutFile) {
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($OutFile, $result, $utf8)
    Write-Output "WROTE $OutFile ($($result.Length) chars)"
} else {
    Write-Output $result
}
