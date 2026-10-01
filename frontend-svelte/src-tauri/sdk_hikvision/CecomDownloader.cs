using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace WisiCecomDownloader
{
    class Program
    {
        #region Hikvision NET_DVR Native Imports
        [DllImport("HCNetSDK.dll")]
        public static extern bool NET_DVR_Init();

        [DllImport("HCNetSDK.dll")]
        public static extern bool NET_DVR_Cleanup();

        [DllImport("HCNetSDK.dll")]
        public static extern uint NET_DVR_GetLastError();

        [DllImport("HCNetSDK.dll")]
        public static extern bool NET_DVR_SetConnectTime(uint dwWaitTime, uint dwTryTimes);

        [DllImport("HCNetSDK.dll")]
        public static extern bool NET_DVR_SetReconnect(uint dwInterval, bool bEnableRecon);

        [DllImport("HCNetSDK.dll")]
        public static extern int NET_DVR_Login_V40(ref NET_DVR_USER_LOGIN_INFO pLoginInfo, ref NET_DVR_DEVICEINFO_V40 lpDeviceInfo);

        [DllImport("HCNetSDK.dll")]
        public static extern bool NET_DVR_Logout(int lUserID);

        [DllImport("HCNetSDK.dll")]
        public static extern int NET_DVR_GetFileByTime_V40(int lUserID, string sSavedFileName, ref NET_DVR_PLAYCOND pDownloadCond);

        [DllImport("HCNetSDK.dll")]
        public static extern bool NET_DVR_PlayBackControl_V40(int lPlayHandle, uint dwControlCode, IntPtr lpInBuffer, uint dwInLen, IntPtr lpOutBuffer, ref uint lpOutLen);

        [DllImport("HCNetSDK.dll")]
        public static extern int NET_DVR_GetDownloadPos(int lFileHandle);

        [DllImport("HCNetSDK.dll")]
        public static extern bool NET_DVR_StopGetFile(int lFileHandle);
        #endregion

        #region Structs
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
        public struct NET_DVR_USER_LOGIN_INFO
        {
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 129)]
            public string sDeviceAddress;
            public byte byUseTransport;
            public ushort wPort;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
            public string sUserName;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
            public string sPassword;
            public bool bUseAsynLogin;
            public byte byProxyType;
            public byte byUsePrivilege;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 24)]
            public byte[] byRes;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct NET_DVR_DEVICEINFO_V30
        {
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 48)]
            public byte[] sSerialNumber;
            public byte byAlarmInPortNum;
            public byte byAlarmOutPortNum;
            public byte byDiskNum;
            public byte byDVRType;
            public byte byChanNum;
            public byte byStartChan;
            public byte byAudioChanNum;
            public byte byIPChanNum;
            public byte byZeroChanNum;
            public byte byMainProto;
            public byte bySubProto;
            public byte bySupport;
            public byte bySupport1;
            public byte bySupport2;
            public ushort wDevType;
            public byte bySupport3;
            public byte byMultiStreamProto;
            public byte byStartDChan;
            public byte byStartDTalkChan;
            public byte byHighDChanNum;
            public byte bySupport4;
            public byte byLanguageType;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 9)]
            public byte[] byRes2;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct NET_DVR_DEVICEINFO_V40
        {
            public NET_DVR_DEVICEINFO_V30 struDeviceV30;
            public byte bySupportLock;
            public byte byRetryLoginTime;
            public byte byPasswordLevel;
            public byte byProxyType;
            public uint dwSurplusLockTime;
            public byte byCharEncodeType;
            public byte bySupportDevAbilityV40;
            public byte byLoginMode;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 253)]
            public byte[] byRes2;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct NET_DVR_TIME
        {
            public uint dwYear;
            public uint dwMonth;
            public uint dwDay;
            public uint dwHour;
            public uint dwMinute;
            public uint dwSecond;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct NET_DVR_PLAYCOND
        {
            public int dwChannel;
            public NET_DVR_TIME struStartTime;
            public NET_DVR_TIME struStopTime;
            public byte byDrawFrame;
            public byte byStreamType;   // 0: Main, 1: Sub
            public byte byStreamMode;
            public byte byReserved1;
            public uint dwVoidData;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)]
            public byte[] byRes;
        }
        #endregion

        static string GetErrorDescription(uint errorCode)
        {
            switch (errorCode)
            {
                case 1: return "Usuario o contrasena incorrectos (NET_DVR_PASSWORD_ERROR). Verifique las credenciales del grabador.";
                case 2: return "Grabador no inicializado (NET_DVR_NOINIT).";
                case 3: return "Canal de grabador no disponible o sin senal (NET_DVR_CHANNEL_ERROR).";
                case 4: return "Grabador ocupado o excedio el numero de conexiones simultaneas (NET_DVR_OVER_MAXLINK).";
                case 5: return "Version de SDK no compatible con el dispositivo (NET_DVR_VERSIONNOMATCH).";
                case 7: return "Fallo de conexion de red con el grabador (NET_DVR_NETWORK_FAIL_CONNECT). Verifique que esta PC este conectada a la red del casino y que la IP y el puerto 8000 sean accesibles.";
                case 8: return "Fallo al enviar datos al grabador (NET_DVR_NETWORK_SEND_ERROR).";
                case 9: return "Fallo al recibir datos del grabador (NET_DVR_NETWORK_RECV_ERROR).";
                case 10: return "Tiempo de espera agotado al comunicar con el grabador (NET_DVR_NETWORK_RECV_TIMEOUT).";
                case 11: return "Funcion no soportada por el grabador (NET_DVR_NOSUPPORT).";
                case 17: return "Parametros de consulta invalidos (NET_DVR_PARAMETER_ERROR). Verifique la fecha y rango de horas.";
                case 18: return "Canal no configurado en el grabador (NET_DVR_CHAN_EXCEPTION).";
                case 23: return "El numero de canal especificado no existe en el grabador (NET_DVR_CHANNEL_ERROR).";
                case 29: return "Operacion rechazada por permisos del usuario (NET_DVR_OPERNOPERMIT).";
                case 34: return "No hay video grabado en el rango de fecha y horas indicado (NET_DVR_NORECORD). Verifique que la fecha y hora seleccionadas contengan grabaciones.";
                case 46: return "Memoria del sistema insuficiente (NET_DVR_ALLOC_RESOURCE_ERROR).";
                case 52: return "No existe archivo de video en el grabador (NET_DVR_NOFILE).";
                default: return string.Format("Error SDK Hikvision #{0}", errorCode);
            }
        }

        static NET_DVR_TIME ParseTimeString(string timeStr)
        {
            string clean = timeStr.Replace("\"", "").Trim();
            string[] parts = clean.Split(new char[] { ',', '-', ':', ' ' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 6)
            {
                throw new ArgumentException(string.Format("Formato de tiempo invalido '{0}'. Se espera 'YYYY,MM,DD,HH,mm,ss'", timeStr));
            }
            return new NET_DVR_TIME
            {
                dwYear = uint.Parse(parts[0]),
                dwMonth = uint.Parse(parts[1]),
                dwDay = uint.Parse(parts[2]),
                dwHour = uint.Parse(parts[3]),
                dwMinute = uint.Parse(parts[4]),
                dwSecond = uint.Parse(parts[5])
            };
        }

        static int Main(string[] args)
        {
            if (args.Length < 7)
            {
                Console.WriteLine("USO: Converter.exe <IP> <USER> <PASS> <CANAL> <START_TIME> <STOP_TIME> <OUTPUT_PATH> [MODO]");
                Console.WriteLine("Ejemplo: Converter.exe 192.168.100.14 admin Jjnc0412 2 2026,9,30,20,00,00 2026,9,30,20,30,00 C:\\videos\\prueba.mp4");
                return 1;
            }

            string ip = args[0].Trim();
            string user = args[1].Trim();
            string pass = args[2].Trim();
            int reqChannel = int.Parse(args[3].Trim());
            string startTimeStr = args[4].Trim();
            string stopTimeStr = args[5].Trim();
            string outputPath = Path.GetFullPath(args[6].Trim());
            string modo = (args.Length >= 8) ? args[7].Trim().ToLower() : "main";

            // Asegurar directorio destino
            string destDir = Path.GetDirectoryName(outputPath);
            if (!string.IsNullOrEmpty(destDir) && !Directory.Exists(destDir))
            {
                Directory.CreateDirectory(destDir);
            }

            Console.WriteLine(string.Format("INIT: Conectando con grabador {0}:8000 (Canal {1})...", ip, reqChannel));

            if (!NET_DVR_Init())
            {
                uint err = NET_DVR_GetLastError();
                Console.WriteLine(string.Format("ERROR:INIT_FAIL:{0}", GetErrorDescription(err)));
                return 1;
            }

            NET_DVR_SetConnectTime(6000, 3);
            NET_DVR_SetReconnect(10000, true);

            NET_DVR_USER_LOGIN_INFO loginInfo = new NET_DVR_USER_LOGIN_INFO
            {
                sDeviceAddress = ip,
                sUserName = user,
                sPassword = pass,
                wPort = 8000,
                byUseTransport = 0,
                bUseAsynLogin = false
            };

            NET_DVR_DEVICEINFO_V40 devInfo = new NET_DVR_DEVICEINFO_V40();
            int userId = NET_DVR_Login_V40(ref loginInfo, ref devInfo);

            if (userId < 0)
            {
                uint err = NET_DVR_GetLastError();
                string desc = GetErrorDescription(err);
                Console.WriteLine(string.Format("LOGIN_ERROR:{0}:{1}", err, desc));
                NET_DVR_Cleanup();
                return 2;
            }

            Console.WriteLine(string.Format("LOGIN_OK: Sesion iniciada correctamente con {0}", ip));

            // Analisis de canales del grabador (analogico vs IP)
            byte startChan = devInfo.struDeviceV30.byStartChan > 0 ? devInfo.struDeviceV30.byStartChan : (byte)1;
            byte chanNum = devInfo.struDeviceV30.byChanNum;
            byte startDChan = devInfo.struDeviceV30.byStartDChan > 0 ? devInfo.struDeviceV30.byStartDChan : (byte)33;

            // Determinar candidatos de canal
            int[] channelCandidates;
            if (reqChannel >= 33)
            {
                channelCandidates = new int[] { reqChannel };
            }
            else if (reqChannel <= chanNum && chanNum > 0)
            {
                // Es un canal analógico (1..16), pero si falla probamos digital
                channelCandidates = new int[] { startChan + reqChannel - 1, startDChan + reqChannel - 1, reqChannel + 32 };
            }
            else
            {
                // Es un canal IP en DVR híbrido (ej. canal 2 -> 33 + 2 - 1 = 34 o 32 + 2 = 34)
                channelCandidates = new int[] { startDChan + reqChannel - 1, reqChannel + 32, reqChannel };
            }

            NET_DVR_TIME startTime = ParseTimeString(startTimeStr);
            NET_DVR_TIME stopTime = ParseTimeString(stopTimeStr);

            int downloadHandle = -1;
            int resolvedChannel = reqChannel;
            uint lastErr = 0;

            foreach (int ch in channelCandidates)
            {
                NET_DVR_PLAYCOND cond = new NET_DVR_PLAYCOND
                {
                    dwChannel = ch,
                    struStartTime = startTime,
                    struStopTime = stopTime,
                    byStreamType = (byte)(modo == "sub" ? 1 : 0),
                    byDrawFrame = 0
                };

                Console.WriteLine(string.Format("QUERY: Solicitando grabacion en canal {0}...", ch));
                downloadHandle = NET_DVR_GetFileByTime_V40(userId, outputPath, ref cond);

                if (downloadHandle >= 0)
                {
                    resolvedChannel = ch;
                    Console.WriteLine(string.Format("STREAM_FOUND: Canal {0} localizado con grabaciones activas.", ch));
                    break;
                }
                else
                {
                    lastErr = NET_DVR_GetLastError();
                    Console.WriteLine(string.Format("CANDIDATE_FAIL: Canal {0} fallo (Error {1}: {2})", ch, lastErr, GetErrorDescription(lastErr)));
                }
            }

            if (downloadHandle < 0)
            {
                string desc = GetErrorDescription(lastErr);
                Console.WriteLine(string.Format("DOWNLOAD_ERROR:{0}:{1}", lastErr, desc));
                NET_DVR_Logout(userId);
                NET_DVR_Cleanup();
                return 3;
            }

            // Iniciar flujo de descarga (NET_DVR_PLAYSTART = 1)
            uint outLen = 0;
            NET_DVR_PlayBackControl_V40(downloadHandle, 1, IntPtr.Zero, 0, IntPtr.Zero, ref outLen);

            int downloadPos = 0;
            int stallCount = 0;

            while (downloadPos < 100)
            {
                int currentPos = NET_DVR_GetDownloadPos(downloadHandle);
                if (currentPos >= 0 && currentPos <= 100)
                {
                    if (currentPos == downloadPos) stallCount++;
                    else stallCount = 0;

                    downloadPos = currentPos;
                    Console.WriteLine(string.Format("PROGRESS:{0}", downloadPos));
                }
                else if (currentPos > 100)
                {
                    string errDesc = "Fallo durante la transmision";
                    if (currentPos == 101) errDesc = "No se encontraron datos en el disco del grabador para este intervalo (NET_DVR_NORECORD)";
                    else if (currentPos == 102) errDesc = "Desconexion de red o falla de comunicacion durante la extraccion";
                    else if (currentPos == 103) errDesc = "Error en el disco duro o almacenamiento del grabador";
                    else if (currentPos == 104) errDesc = "El archivo solicitado excede el limite de tamano del grabador";
                    else if (currentPos == 105) errDesc = "Espacio insuficiente en el disco local de la PC";
                    Console.WriteLine(string.Format("DOWNLOAD_ERROR:{0}:{1}", currentPos, errDesc));
                    break;
                }
                else
                {
                    uint err = NET_DVR_GetLastError();
                    Console.WriteLine(string.Format("DOWNLOAD_POS_ERROR:{0}:{1}", err, GetErrorDescription(err)));
                    break;
                }

                if (downloadPos >= 100) break;

                // Timeout si se congela por mas de 45 segundos
                if (stallCount > 45)
                {
                    Console.WriteLine("DOWNLOAD_TIMEOUT: El grabador dejo de enviar paquetes durante 45 segundos.");
                    break;
                }

                Thread.Sleep(1000);
            }

            NET_DVR_StopGetFile(downloadHandle);
            NET_DVR_Logout(userId);
            NET_DVR_Cleanup();

            if (downloadPos >= 100)
            {
                if (File.Exists(outputPath) && new FileInfo(outputPath).Length > 0)
                {
                    long fileSize = new FileInfo(outputPath).Length;
                    Console.WriteLine("CONV_PROGRESS:100");
                    Console.WriteLine(string.Format("SUCCESS:{0}:{1}", outputPath, fileSize));
                    Console.WriteLine(string.Format("EXITO: {0}", outputPath));
                    return 0;
                }
                else
                {
                    Console.WriteLine("FILE_MISSING: La descarga indico 100% pero el archivo no se pudo consolidar en disco.");
                    return 4;
                }
            }
            else
            {
                Console.WriteLine(string.Format("DOWNLOAD_INCOMPLETE: Descarga finalizo en {0}%", downloadPos));
                return 5;
            }
        }
    }
}
