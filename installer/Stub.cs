using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;

class NgaExtSetup
{
    static readonly byte[] Magic = Encoding.ASCII.GetBytes("NGAEXTPK");

    static int Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        string self = Assembly.GetExecutingAssembly().Location;
        string temp = Path.Combine(Path.GetTempPath(), "NGAExt_" + Guid.NewGuid().ToString("N").Substring(0, 8));
        int exit = 1;

        try
        {
            long zipLen = ReadFooter(self);
            if (zipLen <= 0) { Console.WriteLine("安装器损坏：找不到内置数据。"); Pause(); return 2; }

            Console.WriteLine("正在解包（首次较慢）...");
            Directory.CreateDirectory(temp);

            using (FileStream fs = new FileStream(self, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                long start = fs.Length - zipLen - 16;
                fs.Seek(start, SeekOrigin.Begin);
                string zipPath = Path.Combine(temp, "_payload.zip");
                using (FileStream outp = new FileStream(zipPath, FileMode.Create))
                {
                    byte[] buf = new byte[1 << 20];
                    long remain = zipLen;
                    while (remain > 0)
                    {
                        int n = fs.Read(buf, 0, (int)Math.Min(buf.Length, remain));
                        if (n <= 0) break;
                        outp.Write(buf, 0, n);
                        remain -= n;
                    }
                }
                ZipFile.ExtractToDirectory(zipPath, temp);
                File.Delete(zipPath);
            }

            string bat = Path.Combine(temp, "Install.bat");
            if (!File.Exists(bat)) { Console.WriteLine("安装器损坏：缺少 Install.bat"); Pause(); return 3; }

            Console.WriteLine("开始安装...\r\n");
            ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", "/c \"\"" + bat + "\"\"");
            psi.WorkingDirectory = temp;
            psi.UseShellExecute = false;
            Process p = Process.Start(psi);
            p.WaitForExit();
            exit = p.ExitCode;
        }
        catch (Exception ex)
        {
            Console.WriteLine("安装失败: " + ex.Message);
            exit = 9;
        }
        finally
        {
            try { Directory.Delete(temp, true); } catch { }
            Console.WriteLine("\r\n临时文件已清理。");
        }

        if (exit != 0) Pause();
        return exit;
    }

    static long ReadFooter(string path)
    {
        using (FileStream fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            if (fs.Length < 16) return -1;
            fs.Seek(-16, SeekOrigin.End);
            byte[] buf = new byte[16];
            fs.Read(buf, 0, 16);
            for (int i = 0; i < 8; i++) if (buf[8 + i] != Magic[i]) return -1;
            return BitConverter.ToInt64(buf, 0);
        }
    }

    static void Pause()
    {
        Console.WriteLine("按回车键退出...");
        Console.ReadLine();
    }
}
