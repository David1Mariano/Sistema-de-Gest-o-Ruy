using System;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;
using System.Threading;
using System.Runtime.InteropServices;
// SCM host, not a node.exe registered as if it implemented ServiceBase.
public sealed class RuyCentralService : ServiceBase {
 readonly string node, script, profile; Process child; bool stopping; readonly bool console; IntPtr job=IntPtr.Zero;
 [StructLayout(LayoutKind.Sequential)] struct BasicLimits { public long ProcessTime,JobTime; public uint Flags; public UIntPtr MinWorking,MaxWorking; public uint ActiveProcesses; public UIntPtr Affinity; public uint Priority,Scheduling; }
 [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOperations,WriteOperations,OtherOperations,ReadBytes,WriteBytes,OtherBytes; }
 [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits { public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMemory,JobMemory,PeakProcessMemory,PeakJobMemory; }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr handle,int kind,ref ExtendedLimits limits,uint length);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr handle,IntPtr process);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
 void CloseJob(){if(job!=IntPtr.Zero){CloseHandle(job);job=IntPtr.Zero;}}
 RuyCentralService(string[] a) { ServiceName="SistemaRuyCentralRc1"; CanStop=true; AutoLog=false; console=a[0]=="--console"; node=CheckedPath(a[1],true); script=CheckedPath(a[2],true); profile=CheckedPath(a[3],false); }
 static string CheckedPath(string p,bool file) { if(p.IndexOf('"')>=0 || !Path.IsPathRooted(p) || (file?!File.Exists(p):!Directory.Exists(p)))throw new ArgumentException("Absolute existing paths required"); return Path.GetFullPath(p); }
 void StartCore() {
  job=CreateJobObject(IntPtr.Zero,null);var limits=new ExtendedLimits();limits.Basic.Flags=0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
  if(job==IntPtr.Zero||!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimits)))){CloseJob();throw new Exception("Owned process job unavailable");}
  var info=new ProcessStartInfo(node,"\""+script+"\" \""+profile+"\"") { UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true,WorkingDirectory=Path.GetDirectoryName(script) };
  info.EnvironmentVariables.Remove("NODE_OPTIONS");
  var dataDirectory=Directory.GetParent(profile).FullName;if(Path.GetFileName(dataDirectory).Equals("audits",StringComparison.OrdinalIgnoreCase))dataDirectory=Directory.GetParent(dataDirectory).FullName;
  if(!Path.GetFileName(dataDirectory).Equals("GestaoRuy",StringComparison.OrdinalIgnoreCase))throw new ArgumentException("Explicit GestaoRuy service data root required");
  info.EnvironmentVariables["RUY_CENTRAL_DATA_ROOT"]=dataDirectory;
  child=new Process { StartInfo=info,EnableRaisingEvents=true }; child.OutputDataReceived+=(s,e)=>{}; child.ErrorDataReceived+=(s,e)=>{};
  child.Exited+=(s,e)=>{if(!stopping)Environment.Exit(2);};
  child.Start();if(!AssignProcessToJobObject(job,child.Handle)){stopping=true;child.Kill();CloseJob();throw new Exception("Owned process containment unavailable");}child.BeginOutputReadLine();child.BeginErrorReadLine();
 }
 void StopCore() { stopping=true;if(child==null||child.HasExited){CloseJob();return;}child.StandardInput.WriteLine("shutdown");child.StandardInput.Flush();if(!child.WaitForExit(40000))throw new System.TimeoutException("Graceful shutdown pending; no process was force-terminated");CloseJob();if(child.ExitCode!=0)throw new Exception("Supervisor shutdown failed"); }
 protected override void OnStart(string[] args) { StartCore(); }
 protected override void OnStop() { RequestAdditionalTime(45000);StopCore(); }
 public static int Main(string[] args) { try { if(args.Length!=4||(args[0]!="--console"&&args[0]!="--service"&&args[0]!="--task"))return 64;var service=new RuyCentralService(args);if(args[0]=="--task"){service.StartCore();service.child.WaitForExit();return service.child.ExitCode;}if(service.console){service.StartCore();while(Console.ReadLine()!="shutdown"){}service.StopCore();}else ServiceBase.Run(service);return 0;}catch{return 2;} }
}
