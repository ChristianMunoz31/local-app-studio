# Reads the process table for scripts/phase/cleanup.js: one Get-CimInstance Win32_Process query, then each process's
# current directory from its PEB (read only). It NEVER stops, signals or changes anything.
# Output: UTF-8 JSON, an array of { pid, ppid, name, cwd, cmd, created } (cwd is null when the process cannot be opened).
#   -Root <dir>       keep only rows whose cwd or command line contains <dir> (IndexOf, OrdinalIgnoreCase: no wildcards)
#   -ProcessId <n>    emit only that process (an empty array when it is gone)
# Ported from the workspace scanner (cwdscan.ps1). The PEB offsets are 64-bit: a 32-bit process reports a null or stale cwd.
param([string]$Root = '', [int]$ProcessId = 0)
$ErrorActionPreference = 'Stop'
$sig = @'
using System;
using System.Runtime.InteropServices;
public static class PebRead {
  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int size, out IntPtr read);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  [DllImport("ntdll.dll")] public static extern int NtQueryInformationProcess(IntPtr h, int cls, byte[] info, int len, out int ret);
  public static string Cwd(int pid) {
    IntPtr h = OpenProcess(0x0410, false, pid);
    if (h == IntPtr.Zero) return null;
    try {
      byte[] pbi = new byte[48]; int ret;
      if (NtQueryInformationProcess(h, 0, pbi, pbi.Length, out ret) != 0) return null;
      IntPtr peb = (IntPtr)BitConverter.ToInt64(pbi, 8);
      byte[] p = new byte[8]; IntPtr r;
      if (!ReadProcessMemory(h, (IntPtr)(peb.ToInt64() + 0x20), p, 8, out r)) return null;
      IntPtr pp = (IntPtr)BitConverter.ToInt64(p, 0);
      byte[] us = new byte[16];
      if (!ReadProcessMemory(h, (IntPtr)(pp.ToInt64() + 0x38), us, 16, out r)) return null;
      ushort len = BitConverter.ToUInt16(us, 0);
      IntPtr buf = (IntPtr)BitConverter.ToInt64(us, 8);
      if (len == 0 || buf == IntPtr.Zero) return "";
      byte[] s = new byte[len];
      if (!ReadProcessMemory(h, buf, s, len, out r)) return null;
      return System.Text.Encoding.Unicode.GetString(s);
    } finally { CloseHandle(h); }
  }
}
'@
if (-not ([System.Management.Automation.PSTypeName]'PebRead').Type) { Add-Type -TypeDefinition $sig }
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$procs = if ($ProcessId -gt 0) { @(Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId") } else { @(Get-CimInstance Win32_Process) }
$rows = New-Object System.Collections.ArrayList
foreach ($p in $procs) {
  $id = [int]$p.ProcessId
  $cwd = $null
  if ($id -gt 4) { try { $cwd = [PebRead]::Cwd($id) } catch { $cwd = $null } }
  $cmd = if ($p.CommandLine) { [string]$p.CommandLine } else { '' }
  if ($Root -ne '') {
    $hit = (($cwd -ne $null) -and ($cwd.IndexOf($Root, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)) -or ($cmd.IndexOf($Root, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)
    if (-not $hit) { continue }
  }
  $created = if ($p.CreationDate) { ([datetime]$p.CreationDate).ToUniversalTime().ToString('o') } else { $null }
  [void]$rows.Add([pscustomobject]@{ pid = $id; ppid = [int]$p.ParentProcessId; name = [string]$p.Name; cwd = $cwd; cmd = $cmd; created = $created })
}
[Console]::Out.Write((ConvertTo-Json -InputObject @($rows) -Compress -Depth 3))
