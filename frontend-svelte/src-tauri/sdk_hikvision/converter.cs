using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.IO;
using System.Diagnostics;

namespace HikvisionDownloader
{
    class Program
    {
        #region SDK NET_DVR
        [DllImport("HCNetSDK.dll")] public static extern bool NET_DVR_Init();
        [DllImport("HCNetSDK.dll")] public static extern int NET_DVR_Login_V40(ref NET_DVR_USER_LOGIN_INFO pLoginInfo, ref NET_DVR_DEVICEINFO_V40 lpDeviceInfo);
        [DllImport("HCNetSDK.dll")] public static extern uint NET_DVR_GetLastError();
        [DllImport("HCNetSDK.dll")] public static extern int NET_DVR_GetFileByTime_V40(int lUserID, string sSavedFileName, ref NET_DVR_PLAYCOND pDownloadCond);
        [DllImport("HCNetSDK.dll")] public static extern bool NET_DVR_PlayBackControl_V40(int lPlayHandle, uint dwControlCode, IntPtr lpInBuffer, uint dwInLen, IntPtr lpOutBuffer, ref uint lpOutLen);
        [DllImport("HCNetSDK.dll")] public static extern int NET_DVR_GetDownloadPos(int lFileHandle);
        [DllImport("HCNetSDK.dll")] public static extern bool NET_DVR_StopGetFile(int lFileHandle);
        [DllImport("HCNetSDK.dll")] public static extern bool NET_DVR_Logout(int lUserID);
        [DllImport("HCNetSDK.dll")] public static extern bool NET_DVR_Cleanup();
        #endregion

        #region Estructuras
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
        public struct NET_DVR_USER_LOGIN_INFO {
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 129)] public string sDeviceAddress;
            public byte byUseTransport; public ushort wPort;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string sUserName;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string sPassword;
            public bool bUseAsynLogin; public byte byProxyType; public byte byUsePrivilege;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 24)] public byte[] byRes;
        }
        [StructLayout(LayoutKind.Sequential)]
        public struct NET_DVR_DEVICEINFO_V40 {
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 256)] public byte[] struDeviceV30;
            public byte bySupportLock; public byte byRetryLoginTime; public byte byPasswordLevel;
            public byte byProxyType; public uint dwSurplusLockTime; public byte byCharEncodeType;
            public byte bySupportDevAbilityV40; public byte byLoginMode;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 253)] public byte[] byRes2;
        }
        [StructLayout(LayoutKind.Sequential)]
        public struct NET_DVR_TIME {
            public uint dwYear; public uint dwMonth; public uint dwDay;
            public uint dwHour; public uint dwMinute; public uint dwSecond;
        }
        [StructLayout(LayoutKind.Sequential)]
        public struct NET_DVR_PLAYCOND {
            public int dwChannel; public NET_DVR_TIME struStartTime; public NET_DVR_TIME struStopTime;
            public byte byDrawFrame; public byte byStreamType; public byte byStreamMode;
            public byte byReserved1; public uint dwVoidData;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)] public byte[] byRes;
        }
        #endregion

        static void Main(string[] args)
        {
            if (args.Length < 7) { 
                Console.WriteLine("Uso: Converter.exe IP USER PASS CH START STOP DEST [MODO]");
                return; 
            }

            // Limpieza y preparación [cite: 2026-02-18]
            int downloadPos = 0; 
            string originalDest = Path.GetFullPath(args[6]);
            string tempRawPath = originalDest + ".raw";
            string startTimeStr = args[4];
            string stopTimeStr = args[5];
            string modo = (args.Length >= 8) ? args[7].ToLower() : "copy";

            if (!NET_DVR_Init()) return;

            NET_DVR_USER_LOGIN_INFO loginInfo = new NET_DVR_USER_LOGIN_INFO {
                sDeviceAddress = args[0], sUserName = args[1], sPassword = args[2], wPort = 8000
            };
            NET_DVR_DEVICEINFO_V40 deviceInfo = new NET_DVR_DEVICEINFO_V40();
            int userId = NET_DVR_Login_V40(ref loginInfo, ref deviceInfo);

            if (userId < 0) {
                Console.WriteLine($"LOGIN_ERROR:{NET_DVR_GetLastError()}");
                NET_DVR_Cleanup();
                return;
            }

            NET_DVR_PLAYCOND downloadCond = new NET_DVR_PLAYCOND {
                dwChannel = int.Parse(args[3]),
                struStartTime = ParseTimeString(startTimeStr),
                struStopTime = ParseTimeString(stopTimeStr),
                byStreamType = 0 
            };

            // Descargamos usando el nombre original directamente primero
            int downloadHandle = NET_DVR_GetFileByTime_V40(userId, originalDest, ref downloadCond);
            
            if (downloadHandle >= 0)
            {
                uint outLen = 0;
                NET_DVR_PlayBackControl_V40(downloadHandle, 1, IntPtr.Zero, 0, IntPtr.Zero, ref outLen);

                while (downloadPos < 100)
                {
                    downloadPos = NET_DVR_GetDownloadPos(downloadHandle);
                    if (downloadPos >= 0) Console.WriteLine($"PROGRESS:{downloadPos}");
                    if (downloadPos >= 100 || downloadPos < 0) break; 
                    Thread.Sleep(1000);
                }
                NET_DVR_StopGetFile(downloadHandle);

                if (downloadPos == 100)
                {   
                    // Renombrar a .raw para que FFmpeg pueda escribir en el nombre original
                    if (File.Exists(tempRawPath)) File.Delete(tempRawPath);
                    File.Move(originalDest, tempRawPath);

                    ConvertirConFFmpeg(tempRawPath, originalDest, modo, startTimeStr, stopTimeStr);
                    
                    if (File.Exists(tempRawPath)) File.Delete(tempRawPath);
                }
            }
            NET_DVR_Logout(userId);
            NET_DVR_Cleanup();
        }

        static void ConvertirConFFmpeg(string inputFile, string outputFile, string modo, string startStr, string stopStr)
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string ffmpegPath = Path.GetFullPath(Path.Combine(baseDir, "..", "ffmpeg", "bin", "ffmpeg.exe"));
            string arguments = "";
            double totalSeconds = CalcularDiferenciaSegundos(startStr, stopStr);

            if (modo == "f") {
                arguments = $"-y -i \"{inputFile}\" -c copy \"{outputFile}\"";
            } else {
                // arguments = $"-y -fflags +genpts+igndts+flush_packets -i \"{inputFile}\" -vf \"scale=-2:1080,format=yuv420p,setpts=PTS-STARTPTS\" -c:v libx264 -preset superfast -crf 34 -profile:v main -level 4.0 -r 30 -vsync cfr -tune zerolatency -map_metadata -1 -movflags +faststart -c:a aac -b:a 128k \"{outputFile}\"";
                // scale=-2:1080 mantiene la proporción desde 6MP. 
                // CRF 32 asegura que el archivo sea "ligero" para el celular.
                arguments = $"-y -fflags +genpts+igndts+flush_packets -i \"{inputFile}\" " +
                            $"-vf \"scale=-2:1080,format=yuv420p,setpts=PTS-STARTPTS\" " +
                            $"-c:v libx264 -preset superfast -crf 32 -profile:v main -level 4.0 " +
                            $"-threads 0 -r 30 -vsync cfr -map_metadata -1 -movflags +faststart " +
                            $"-c:a aac -b:a 128k \"{outputFile}\"";
            
            }

            ProcessStartInfo startInfo = new ProcessStartInfo {
                FileName = ffmpegPath, Arguments = arguments,
                UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true
            };

            using (Process process = new Process()) {
                process.StartInfo = startInfo;
                process.ErrorDataReceived += (sender, e) => {
                    if (!string.IsNullOrEmpty(e.Data) && e.Data.Contains("time=")) {
                        try {
                            string timePart = e.Data.Substring(e.Data.IndexOf("time=") + 5, 11);
                            if (TimeSpan.TryParse(timePart, out TimeSpan currentElapsed)) {
                                double progress = (currentElapsed.TotalSeconds / totalSeconds) * 100;
                                Console.WriteLine($"CONV_PROGRESS:{(int)Math.Min(progress, 100)}");
                            }
                        } catch { }
                    }
                };
                process.Start();
                process.BeginErrorReadLine();
                process.WaitForExit();
                if (process.ExitCode == 0) Console.WriteLine("CONV_PROGRESS:100\nEXITO: " + outputFile);
            }
        }

        static double CalcularDiferenciaSegundos(string start, string stop) {
            try {
                var s = start.Replace("\"", "").Split(',');
                var e = stop.Replace("\"", "").Split(',');
                DateTime t1 = new DateTime(int.Parse(s[0]), int.Parse(s[1]), int.Parse(s[2]), int.Parse(s[3]), int.Parse(s[4]), int.Parse(s[5]));
                DateTime t2 = new DateTime(int.Parse(e[0]), int.Parse(e[1]), int.Parse(e[2]), int.Parse(e[3]), int.Parse(e[4]), int.Parse(e[5]));
                return Math.Max((t2 - t1).TotalSeconds, 1.0);
            } catch { return 1.0; }
        }

        static NET_DVR_TIME ParseTimeString(string timeStr) {
            string[] parts = timeStr.Replace("\"", "").Split(',');
            return new NET_DVR_TIME {
                dwYear = uint.Parse(parts[0]), dwMonth = uint.Parse(parts[1]), dwDay = uint.Parse(parts[2]),
                dwHour = uint.Parse(parts[3]), dwMinute = uint.Parse(parts[4]), dwSecond = uint.Parse(parts[5])
            };
        }
    }
}