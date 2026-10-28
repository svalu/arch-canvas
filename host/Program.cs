// Arch Canvas - WebView2 single-file portable host
// dist/index.html(아이콘 데이터 내장)과 WebView2 SDK DLL을 EXE 리소스(gzip)로 내장하고, 실행 시 EXE 옆 data 폴더에 풀어서 띄운다.
// 캔버스가 만든 "장면(scene) JSON"을 Art::GVML ClipFormat 패키지로 만들어 클립보드에 올리면 PowerPoint에 편집 가능한 도형으로 붙는다.
// 빌드: build.cmd (Roslyn csc, .NET Framework 4.8, x64)
// 검증용 CLI: "Arch Canvas.exe" --scene scene.json [--gvml out.zip]  → 창 없이 클립보드에 올리고 종료

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

// 실행 파일 속성(백신 휴리스틱은 제작사/버전 정보가 없는 EXE 를 더 의심한다)
[assembly: System.Reflection.AssemblyTitle("Arch Canvas")]
[assembly: System.Reflection.AssemblyDescription("AWS architecture diagram canvas for proposals")]
[assembly: System.Reflection.AssemblyCompany("heerang")]
[assembly: System.Reflection.AssemblyProduct("Arch Canvas")]
[assembly: System.Reflection.AssemblyCopyright("2026 heerang")]
[assembly: System.Reflection.AssemblyVersion("0.9.10.0")]
[assembly: System.Reflection.AssemblyFileVersion("0.9.10.0")]

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        // --scene <file> [--gvml <out>] : 테스트 모드 (UI 없이 클립보드 복사)
        string sceneFile = null, gvmlOut = null;
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--scene" && i + 1 < args.Length) sceneFile = args[++i];
            else if (args[i] == "--gvml" && i + 1 < args.Length) gvmlOut = args[++i];
        }
        if (sceneFile != null)
        {
            try
            {
                byte[] gvml = PptClipboard.BuildGvml(File.ReadAllText(sceneFile, Encoding.UTF8));
                if (gvmlOut != null) File.WriteAllBytes(gvmlOut, gvml);
                PptClipboard.SetClipboard(gvml);
                return 0;
            }
            catch (Exception ex)
            {
                File.WriteAllText(Path.Combine(Path.GetTempPath(), "ArchCanvas_scene_error.txt"), ex.ToString());
                return 1;
            }
        }

        try
        {
            Bootstrap.Extract();
        }
        catch (Exception ex)
        {
            MessageBox.Show("내장 파일을 풀지 못했습니다.\n\n" + ex.Message, "Arch Canvas", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        Run();
        return 0;
    }

    // WebView2 타입은 AssemblyResolve 훅이 걸린 뒤에 JIT 되도록 별도 메서드에 둔다.
    [MethodImpl(MethodImplOptions.NoInlining)]
    static void Run()
    {
        Application.Run(new MainForm());
    }
}

/// <summary>EXE에 내장된 리소스(app/..., bin/...)를 data 폴더에 풀고, bin의 DLL을 로드한다.</summary>
static class Bootstrap
{
    public const string AppVersion = "0.9.10";
    public static readonly string ExePath = Assembly.GetExecutingAssembly().Location;
    public static readonly string BaseDir = Path.GetDirectoryName(ExePath);
    public static string DataDir;    // EXE 옆 data\ (쓰기 불가하면 %LocalAppData%\ArchCanvas\data)
    public static string AppDir;     // data\app     : index.html, user-templates\
    public static string BinDir;     // data\bin     : WebView2 DLL
    public static string ProfileDir; // data\profile : WebView2 사용자 데이터

    public static void Extract()
    {
        DataDir = PickDataDir();
        AppDir = Path.Combine(DataDir, "app");
        BinDir = Path.Combine(DataDir, "bin");
        ProfileDir = Path.Combine(DataDir, "profile");
        Directory.CreateDirectory(DataDir);

        var asm = Assembly.GetExecutingAssembly();
        string stamp = AppVersion + "|" + File.GetLastWriteTimeUtc(ExePath).Ticks + "|" + new FileInfo(ExePath).Length;
        string stampFile = Path.Combine(DataDir, "extracted.txt");
        bool fresh = !File.Exists(stampFile) || File.ReadAllText(stampFile) != stamp;

        foreach (string name in asm.GetManifestResourceNames())
        {
            if (!name.EndsWith(".gz", StringComparison.OrdinalIgnoreCase)) continue;
            string rel = name.Substring(0, name.Length - 3).Replace('/', '\\');
            string dest = Path.Combine(DataDir, rel);
            if (!fresh && File.Exists(dest)) continue;
            Directory.CreateDirectory(Path.GetDirectoryName(dest));
            try
            {
                using (var rs = asm.GetManifestResourceStream(name))
                using (var gz = new GZipStream(rs, CompressionMode.Decompress))
                using (var fs = new FileStream(dest, FileMode.Create, FileAccess.Write, FileShare.None))
                    gz.CopyTo(fs);
            }
            catch (IOException) when (File.Exists(dest) && rel.StartsWith("bin\\", StringComparison.OrdinalIgnoreCase))
            {
                // 다른 인스턴스가 WebView2 DLL 을 잡고 있으면 덮어쓰지 못한다. 이미 있으니 그대로 쓴다.
            }
        }
        File.WriteAllText(stampFile, stamp);
        Directory.CreateDirectory(Path.Combine(AppDir, "user-templates"));
        UserTemplates.WriteIndex();

        AppDomain.CurrentDomain.AssemblyResolve += (s, e) =>
        {
            string file = Path.Combine(BinDir, new AssemblyName(e.Name).Name + ".dll");
            return File.Exists(file) ? Assembly.LoadFrom(file) : null;
        };
    }

    static string PickDataDir()
    {
        string local = Path.Combine(BaseDir, "data");
        try
        {
            Directory.CreateDirectory(local);
            string probe = Path.Combine(local, ".write_test");
            File.WriteAllText(probe, "");
            File.Delete(probe);
            return local;
        }
        catch
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ArchCanvas", "data");
        }
    }
}

/// <summary>사용자 템플릿: data\app\user-templates\*.json + index.json(파일 목록). 웹앱이 fetch 로 읽는다.</summary>
static class UserTemplates
{
    public static string Dir { get { return Path.Combine(Bootstrap.AppDir, "user-templates"); } }

    public static void Save(string file, string json)
    {
        string safe = string.Join("_", file.Split(Path.GetInvalidFileNameChars()));
        if (!safe.EndsWith(".json", StringComparison.OrdinalIgnoreCase)) safe += ".json";
        Directory.CreateDirectory(Dir);
        File.WriteAllText(Path.Combine(Dir, safe), json, new UTF8Encoding(false));
        WriteIndex();
    }

    public static void Delete(string file)
    {
        string safe = string.Join("_", (file ?? "").Split(Path.GetInvalidFileNameChars()));
        if (string.IsNullOrEmpty(safe) || !safe.EndsWith(".json", StringComparison.OrdinalIgnoreCase)) return;
        try { File.Delete(Path.Combine(Dir, safe)); } catch { }
        WriteIndex();
    }

    public static void WriteIndex()
    {
        try
        {
            Directory.CreateDirectory(Dir);
            var files = new List<string>();
            foreach (var f in Directory.GetFiles(Dir, "*.json"))
                if (!Path.GetFileName(f).Equals("index.json", StringComparison.OrdinalIgnoreCase)) files.Add(Path.GetFileName(f));
            files.Sort(StringComparer.OrdinalIgnoreCase);
            var ser = new JavaScriptSerializer();
            File.WriteAllText(Path.Combine(Dir, "index.json"), ser.Serialize(new Dictionary<string, object> { { "files", files } }), new UTF8Encoding(false));
        }
        catch { }
    }
}

sealed class MainForm : Form
{
    const string AppVersion = Bootstrap.AppVersion;
    const string Host = "archcanvas.local";
    static readonly string BaseDir = Bootstrap.BaseDir;
    static readonly string AppDir = Bootstrap.AppDir;
    static readonly string DataDir = Bootstrap.ProfileDir;
    static readonly string FixedRuntimeDir = Path.Combine(BaseDir, "WebView2Runtime");
    static readonly string WindowFile = Path.Combine(Bootstrap.DataDir, "window.txt");

    readonly WebView2 _web;

    // 윈도우 제목줄 다크(DWM). Win10 1809+ 는 19, Win10 20H1+/Win11 은 20.
    [System.Runtime.InteropServices.DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
    void SetDarkTitle(bool dark)
    {
        try
        {
            int v = dark ? 1 : 0;
            if (DwmSetWindowAttribute(Handle, 20, ref v, 4) != 0) DwmSetWindowAttribute(Handle, 19, ref v, 4);
            BackColor = ColorTranslator.FromHtml(dark ? "#0b1416" : "#f3f4f6");
            try { _web.DefaultBackgroundColor = BackColor; } catch { }
        }
        catch { }
    }

    public MainForm()
    {
        Text = "Arch Canvas " + AppVersion;
        BackColor = ColorTranslator.FromHtml("#f3f4f6");
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(1000, 640);
        ClientSize = new Size(1600, 1000);
        ClampToScreen();
        try { Icon = Icon.ExtractAssociatedIcon(Bootstrap.ExePath); } catch { }

        _web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = BackColor };
        Controls.Add(_web);

        Load += async (s, e) => await InitAsync();
        FormClosing += (s, e) => { SaveWindow(); CliRunner.KillAll(); };
        CliRunner.CleanupWork();
    }

    async Task InitAsync()
    {
        RestoreWindow();
        string index = Path.Combine(AppDir, "index.html");
        if (!File.Exists(index))
        {
            MessageBox.Show(this, "app\\index.html 파일을 찾을 수 없습니다.\n\n" + index, "Arch Canvas", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
            return;
        }
        try
        {
            Directory.CreateDirectory(DataDir);
            var opts = new CoreWebView2EnvironmentOptions { Language = "ko" };
            string runtime = Directory.Exists(FixedRuntimeDir) ? FixedRuntimeDir : null;
            var env = await CoreWebView2Environment.CreateAsync(runtime, DataDir, opts);
            await _web.EnsureCoreWebView2Async(env);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            RuntimeMissing();
            return;
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "WebView2를 시작하지 못했습니다.\n\n" + ex.Message, "Arch Canvas", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
            return;
        }

        var core = _web.CoreWebView2;
        core.SetVirtualHostNameToFolderMapping(Host, AppDir, CoreWebView2HostResourceAccessKind.Allow);
        var st = core.Settings;
        // 배포본에서는 F12 를 막는다 (저장된 키를 꺼낼 수 있으므로). 개발할 때만 ARCH_CANVAS_DEV=1
        st.AreDevToolsEnabled = Environment.GetEnvironmentVariable("ARCH_CANVAS_DEV") == "1";
        st.IsStatusBarEnabled = false;
        st.IsGeneralAutofillEnabled = false;
        st.IsPasswordAutosaveEnabled = false;
        st.IsSwipeNavigationEnabled = false;
        st.AreBrowserAcceleratorKeysEnabled = true;
        st.IsZoomControlEnabled = true;

        await core.AddScriptToExecuteOnDocumentCreatedAsync(BridgeJs);
        core.WebMessageReceived += OnWebMessage;
        core.PermissionRequested += (s, e) =>
            e.State = e.PermissionKind == CoreWebView2PermissionKind.ClipboardRead ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
        core.NewWindowRequested += (s, e) => { e.Handled = true; OpenExternal(e.Uri); };
        core.NavigationStarting += (s, e) => { if (IsAppUri(e.Uri)) return; e.Cancel = true; OpenExternal(e.Uri); };
        core.Navigate("https://" + Host + "/index.html");
    }

    // window.desktop:
    //   copyScene(장면 JSON) → PowerPoint 도형 복사 / save(bytes, file) → 다운로드 폴더 / saveTemplate(file, json) → user-templates
    //   call(method, params) → Promise. 호스트가 {id, ok, result|error} 로 답한다. (ai.run / ai.cancel / cli.detect / secret.get / secret.set)
    const string BridgeJs = @"(function(){
  function b64(u8){var s='';for(var i=0;i<u8.length;i+=0x8000){s+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000));}return btoa(s);}
  var pending={}, seq=0;
  window.chrome.webview.addEventListener('message', function(ev){
    var d=ev.data; if(typeof d==='string'){ try{ d=JSON.parse(d);}catch(e){ return; } }
    if(!d||!d.id||!pending[d.id]) return;
    var p=pending[d.id]; delete pending[d.id];
    if(d.ok) p.resolve(d.result); else { var err=new Error(d.error||'host error'); err.detail=d.detail; p.reject(err); }
  });
  window.desktop={
    version:'" + AppVersion + @"',
    copyScene:async function(json){window.chrome.webview.postMessage('scene\n'+json);},
    save:async function(u8,file){window.chrome.webview.postMessage('save\n'+file+'\n'+b64(u8));return true;},
    saveTemplate:async function(file,json){window.chrome.webview.postMessage('template\n'+file+'\n'+json);await new Promise(function(r){setTimeout(r,400);});},
    call:function(method,params){ return new Promise(function(resolve,reject){ var id='c'+(++seq); pending[id]={resolve:resolve,reject:reject}; window.chrome.webview.postMessage(JSON.stringify({id:id,method:method,params:params||{}})); }); }
  };
})();";

    void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        // 앱 페이지(https://archcanvas.local)에서 온 메시지만 받는다
        Uri src;
        if (!Uri.TryCreate(e.Source, UriKind.Absolute, out src) || src.Scheme != "https" || !string.Equals(src.Host, Host, StringComparison.OrdinalIgnoreCase)) return;
        string msg;
        try { msg = e.TryGetWebMessageAsString(); } catch { return; }
        if (string.IsNullOrEmpty(msg)) return;
        if (msg[0] == '{') { HandleCall(msg); return; }
        var p = msg.Split(new[] { '\n' }, 3);
        try
        {
            if (p[0] == "scene" && p.Length >= 2)
                PptClipboard.CopyScene(msg.Substring(6));
            else if (p[0] == "save" && p.Length == 3)
                SaveToDownloads(p[1], Convert.FromBase64String(p[2]));
            else if (p[0] == "template" && p.Length == 3)
                UserTemplates.Save(p[1], p[2]);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, "처리하지 못했습니다.\n\n" + ex.Message, "Arch Canvas", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    // ----- call 브리지: 오래 걸리는 건(CLI) 백그라운드에서 돌리고, 답은 UI 스레드에서 PostWebMessageAsString -----
    void HandleCall(string json)
    {
        var ser = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        Dictionary<string, object> req;
        try { req = ser.DeserializeObject(json) as Dictionary<string, object>; } catch { return; }
        if (req == null) return;
        string id = req.ContainsKey("id") ? req["id"] as string : null;
        string method = (req.ContainsKey("method") ? req["method"] as string : null) ?? "";
        var prm = req.ContainsKey("params") && req["params"] is Dictionary<string, object> ? (Dictionary<string, object>)req["params"] : new Dictionary<string, object>();
        if (id == null) return;
        Task.Run(() =>
        {
            object result = null; string error = null, detail = null;
            try
            {
                switch (method)
                {
                    case "cli.detect": result = CliRunner.Detect(); break;
                    case "ai.run": result = CliRunner.Run(prm); break;
                    case "ai.cancel": CliRunner.Cancel(S(prm, "runId")); result = true; break;
                    case "secret.get": result = new Dictionary<string, object> { { "value", Secrets.Get(S(prm, "name")) } }; break;
                    case "secret.set": Secrets.Set(S(prm, "name"), S(prm, "value")); result = true; break;
                    case "file.saveAs": result = FileSaveAs(S(prm, "name"), S(prm, "text")); break;
                    case "file.save": result = FileSave(S(prm, "path"), S(prm, "text")); break;
                    case "file.open": result = FileOpen(); break;
                    case "template.delete": UserTemplates.Delete(S(prm, "file")); result = true; break;
                    case "update.check": result = Updater.Check(); break;
                    case "update.apply": result = Updater.Apply(prm, () => BeginInvoke(new Action(() => { try { Close(); } catch { Application.Exit(); } }))); break;
                    case "win.dark": { bool d = S(prm, "dark") == "True" || S(prm, "dark") == "true"; BeginInvoke(new Action(() => SetDarkTitle(d))); result = true; break; }
                    default: error = "모르는 호출: " + method; break;
                }
            }
            catch (CliRunner.CliException ex) { error = ex.Message; detail = ex.Detail; }
            catch (Exception ex) { error = ex.Message; detail = ex.ToString(); }
            var reply = new Dictionary<string, object> { { "id", id }, { "ok", error == null }, { "result", result }, { "error", error }, { "detail", detail } };
            string text = ser.Serialize(reply);
            try { BeginInvoke(new Action(() => { try { _web.CoreWebView2.PostWebMessageAsString(text); } catch { } })); } catch { }
        });
    }

    static string S(Dictionary<string, object> d, string k) { object v; return d.TryGetValue(k, out v) && v != null ? v.ToString() : ""; }

    static void SaveToDownloads(string file, byte[] bytes)
    {
        string dir = DownloadsDir();
        Directory.CreateDirectory(dir);
        string safe = string.Join("_", (file ?? "diagram.json").Split(Path.GetInvalidFileNameChars()));
        string path = Path.Combine(dir, safe);
        string stem = Path.GetFileNameWithoutExtension(safe), ext = Path.GetExtension(safe);
        for (int i = 1; File.Exists(path); i++) path = Path.Combine(dir, stem + " (" + i + ")" + ext);
        File.WriteAllBytes(path, bytes);
    }

    // ----- 파일 저장/열기 (대화상자). 덮어쓰기는 이번 실행에서 사용자가 대화상자로 고른 파일에만 허용 -----
    readonly HashSet<string> _pickedFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    T OnUi<T>(Func<T> f) { return InvokeRequired ? (T)Invoke(f) : f(); }
    object FileSaveAs(string name, string text)
    {
        string path = OnUi(() =>
        {
            using (var d = new SaveFileDialog { Filter = "Arch Canvas 다이어그램 (*.arch.json)|*.arch.json|JSON (*.json)|*.json", FileName = string.Join("_", (name ?? "diagram").Split(Path.GetInvalidFileNameChars())), InitialDirectory = DownloadsDir(), OverwritePrompt = true, AddExtension = true, DefaultExt = "arch.json" })
                return d.ShowDialog(this) == DialogResult.OK ? d.FileName : null;
        });
        if (path == null) return new Dictionary<string, object> { { "cancelled", true } };
        File.WriteAllText(path, text ?? "", new UTF8Encoding(false));
        lock (_pickedFiles) _pickedFiles.Add(path);
        return new Dictionary<string, object> { { "path", path }, { "name", Path.GetFileName(path) } };
    }
    object FileSave(string path, string text)
    {
        bool ok; lock (_pickedFiles) ok = !string.IsNullOrEmpty(path) && _pickedFiles.Contains(path);
        if (!ok) return new Dictionary<string, object> { { "needDialog", true } };
        File.WriteAllText(path, text ?? "", new UTF8Encoding(false));
        return new Dictionary<string, object> { { "path", path }, { "name", Path.GetFileName(path) } };
    }
    object FileOpen()
    {
        string path = OnUi(() =>
        {
            using (var d = new OpenFileDialog { Filter = "Arch Canvas 다이어그램 (*.json)|*.json|모든 파일 (*.*)|*.*", InitialDirectory = DownloadsDir() })
                return d.ShowDialog(this) == DialogResult.OK ? d.FileName : null;
        });
        if (path == null) return new Dictionary<string, object> { { "cancelled", true } };
        if (new FileInfo(path).Length > 50L * 1024 * 1024) throw new Exception("파일이 너무 큽니다 (50MB 초과)");
        lock (_pickedFiles) _pickedFiles.Add(path);
        return new Dictionary<string, object> { { "path", path }, { "name", Path.GetFileName(path) }, { "text", File.ReadAllText(path, Encoding.UTF8) } };
    }

    // 다운로드 폴더: OneDrive 등으로 옮겨져 있어도 실제 위치(Known Folder)를 쓴다
    [System.Runtime.InteropServices.DllImport("shell32.dll")]
    static extern int SHGetKnownFolderPath([System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.LPStruct)] Guid id, uint flags, IntPtr token, out IntPtr path);
    static string DownloadsDir()
    {
        try
        {
            IntPtr p;
            if (SHGetKnownFolderPath(new Guid("374DE290-123F-4565-9164-39C4925E467B"), 0, IntPtr.Zero, out p) == 0)
            {
                string d = System.Runtime.InteropServices.Marshal.PtrToStringUni(p);
                System.Runtime.InteropServices.Marshal.FreeCoTaskMem(p);
                if (!string.IsNullOrEmpty(d)) return d;
            }
        }
        catch { }
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
    }

    static bool IsAppUri(string uri)
    {
        Uri u;
        if (!Uri.TryCreate(uri, UriKind.Absolute, out u)) return false;
        if (uri == "about:blank") return true;
        return u.Scheme == "https" && string.Equals(u.Host, Host, StringComparison.OrdinalIgnoreCase);
    }

    static void OpenExternal(string uri)
    {
        Uri u;
        if (!Uri.TryCreate(uri, UriKind.Absolute, out u)) return;
        if (u.Scheme != "http" && u.Scheme != "https") return;
        try { Process.Start(new ProcessStartInfo(u.ToString()) { UseShellExecute = true }); } catch { }
    }

    void RuntimeMissing()
    {
        var r = MessageBox.Show(this,
            "이 PC에 WebView2 런타임이 없습니다.\n\n[예] 런타임 다운로드 페이지 열기 (Microsoft)\n\n" +
            "런타임 설치가 어려우면 WebView2 고정 버전 런타임을 WebView2Runtime 폴더에 넣어도 됩니다.",
            "Arch Canvas", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
        if (r == DialogResult.Yes) OpenExternal("https://developer.microsoft.com/microsoft-edge/webview2/");
        Close();
    }

    void ClampToScreen()
    {
        var wa = Screen.FromPoint(Cursor.Position).WorkingArea;
        Size = new Size(Math.Min(Width, wa.Width), Math.Min(Height, wa.Height));
    }

    void RestoreWindow()
    {
        try
        {
            if (!File.Exists(WindowFile)) return;
            var p = File.ReadAllText(WindowFile).Trim().Split(',');
            if (p.Length < 5) return;
            var rect = new Rectangle(int.Parse(p[0]), int.Parse(p[1]), int.Parse(p[2]), int.Parse(p[3]));
            bool visible = false;
            foreach (var sc in Screen.AllScreens) if (sc.WorkingArea.IntersectsWith(rect)) { visible = true; break; }
            if (!visible) return;
            StartPosition = FormStartPosition.Manual;
            Bounds = rect;
            if (p[4] == "1") WindowState = FormWindowState.Maximized;
        }
        catch { }
    }

    void SaveWindow()
    {
        try
        {
            Directory.CreateDirectory(Bootstrap.DataDir);
            var b = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            File.WriteAllText(WindowFile, string.Join(",", b.X, b.Y, b.Width, b.Height, WindowState == FormWindowState.Maximized ? "1" : "0"));
        }
        catch { }
    }
}

/// <summary>API 키 같은 비밀값. Windows 계정으로 암호화(DPAPI)해서 data\secrets\&lt;name&gt;.bin 에 둔다.</summary>
static class Secrets
{
    static string Dir { get { return Path.Combine(Bootstrap.DataDir, "secrets"); } }
    static string PathOf(string name) { return Path.Combine(Dir, string.Join("_", name.Split(Path.GetInvalidFileNameChars())) + ".bin"); }

    public static string Get(string name)
    {
        string p = PathOf(name);
        if (!File.Exists(p)) return "";
        try { return Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(p), null, DataProtectionScope.CurrentUser)); }
        catch { return ""; }
    }

    public static void Set(string name, string value)
    {
        Directory.CreateDirectory(Dir);
        string p = PathOf(name);
        if (string.IsNullOrEmpty(value)) { if (File.Exists(p)) File.Delete(p); return; }
        File.WriteAllBytes(p, ProtectedData.Protect(Encoding.UTF8.GetBytes(value), null, DataProtectionScope.CurrentUser));
    }
}

/// <summary>
/// AI CLI 실행기. 이 PC 에 설치된 CLI 에 프롬프트(system + user)를 stdin 으로 넣고 답을 돌려준다. 사용자 구독으로 돌아가므로 키가 필요 없다.
///   claude : `claude -p --output-format json` (Claude 구독)
///   codex  : `codex exec -` (OpenAI Codex CLI, ChatGPT 계정 로그인). 답은 -o 파일에서 읽는다.
/// 이 EXE 가 Claude Code 안에서 실행돼도 겹치지 않게 CLAUDE* 환경변수는 지운다.
/// </summary>
static class CliRunner
{
    public class CliException : Exception { public string Detail; public CliException(string m, string d = null) : base(m) { Detail = d; } }
    static readonly Dictionary<string, Process> running = new Dictionary<string, Process>();
    static readonly Dictionary<string, Job> jobs = new Dictionary<string, Job>();
    static readonly HashSet<string> cancelled = new HashSet<string>();
    static readonly System.Text.RegularExpressions.Regex SafeId = new System.Text.RegularExpressions.Regex("^[A-Za-z0-9_-]{1,40}$");
    static readonly System.Text.RegularExpressions.Regex SafeModel = new System.Text.RegularExpressions.Regex("^[A-Za-z0-9._:\\[\\]-]{0,64}$");

    // claude 는 받는 사람 PC 의 설정(~/.claude, 훅, MCP, CLAUDE.md)을 읽지 않고, 도구도 없이, 답만 하게 한다.
    const string LockedArgs = " -p --output-format json --tools \"\" --strict-mcp-config --setting-sources \"\" --disable-slash-commands --no-session-persistence";
    // codex 는 빈 작업 폴더에서 읽기 전용 샌드박스로, git 저장소 확인 없이 한 번만 답한다.
    const string CodexArgs = " exec --skip-git-repo-check --sandbox read-only --color never";

    static bool IsCodex(string tool) { return tool == "codex"; }

    static string WorkRoot { get { return Path.Combine(Bootstrap.DataDir, "ai-work"); } }

    /// <summary>시작할 때: 지난번에 남은 작업 폴더(요건서가 담긴 프롬프트)를 지운다.</summary>
    public static void CleanupWork()
    {
        try { if (Directory.Exists(WorkRoot)) Directory.Delete(WorkRoot, true); } catch { }
    }

    /// <summary>창을 닫을 때: 돌고 있는 claude 를 모두 끝낸다.</summary>
    public static void KillAll()
    {
        List<Job> all;
        lock (running) { all = new List<Job>(jobs.Values); foreach (var k in running.Keys) cancelled.Add(k); }
        foreach (var j in all) { try { j.Dispose(); } catch { } }
        CleanupWork();
    }

    public static string FindClaude() { return FindTool("claude"); }

    public static string FindTool(string name)
    {
        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
        {
            if (string.IsNullOrWhiteSpace(dir)) continue;
            foreach (var n in new[] { name + ".cmd", name + ".exe" })
            {
                try { string f = Path.Combine(dir.Trim(), n); if (File.Exists(f)) return f; } catch { }
            }
        }
        string npm = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "npm", name + ".cmd");
        return File.Exists(npm) ? npm : null;
    }

    // claude.cmd 는 실제 실행 파일(bin\claude.exe 또는 node + cli.js)을 감싼 스크립트다.
    // cmd.exe 를 거치지 않고 실제 실행 파일을 직접 부를 수 있으면 그렇게 한다(백신 오탐 신호 줄이기, stdin 에 UTF-8 직접 쓰기).
    static bool ResolveDirect(string claudeCmd, out string exe, out string argPrefix)
    {
        exe = null; argPrefix = "";
        try
        {
            if (claudeCmd.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) { exe = claudeCmd; return true; }
            string dir = Path.GetDirectoryName(claudeCmd);
            string js;
            if (Path.GetFileNameWithoutExtension(claudeCmd).Equals("codex", StringComparison.OrdinalIgnoreCase))
                js = Path.Combine(dir, "node_modules", "@openai", "codex", "bin", "codex.js");
            else
            {
                string native = Path.Combine(dir, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
                if (File.Exists(native)) { exe = native; return true; }
                js = Path.Combine(dir, "node_modules", "@anthropic-ai", "claude-code", "cli.js");
            }
            if (!File.Exists(js)) return false;
            foreach (var p in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
            {
                try { string n = Path.Combine(p.Trim(), "node.exe"); if (!string.IsNullOrWhiteSpace(p) && File.Exists(n)) { exe = n; argPrefix = "\"" + js + "\" "; return true; } } catch { }
            }
        }
        catch { }
        return false;
    }

    /// <summary>claude 결과는 맨 위에(예전 화면 호환), codex 결과는 "codex" 아래에.</summary>
    public static Dictionary<string, object> Detect()
    {
        var r = DetectOne("claude");
        r["codex"] = DetectOne("codex");
        return r;
    }

    static Dictionary<string, object> DetectOne(string tool)
    {
        string exe = FindTool(tool);
        if (exe == null) return new Dictionary<string, object> { { "found", false }, { "reason", "PATH 에 " + tool + " 가 없습니다" } };
        int code;
        string ver = Quick(exe, "--version", out code);
        var r = new Dictionary<string, object> { { "found", true }, { "path", exe }, { "version", ver } };
        // codex 는 로그인 여부까지 본다 (ChatGPT 계정으로 로그인돼 있으면 exit 0)
        if (IsCodex(tool)) { string st = Quick(exe, "login status", out code); r["loggedIn"] = code == 0; r["login"] = FirstLine(st); }
        return r;
    }

    static string Quick(string exe, string args, out int code)
    {
        code = -1;
        try
        {
            var psi = Psi(exe, args);
            psi.RedirectStandardError = true; psi.StandardErrorEncoding = Encoding.UTF8;
            using (var job = new Job())
            using (var p = Process.Start(psi))
            {
                job.Add(p);
                var sb = new StringBuilder();
                p.OutputDataReceived += (s, e) => { if (e.Data != null) lock (sb) sb.AppendLine(e.Data); };
                p.ErrorDataReceived += (s, e) => { if (e.Data != null) lock (sb) sb.AppendLine(e.Data); };
                p.BeginOutputReadLine(); p.BeginErrorReadLine();
                if (!p.WaitForExit(15000)) return "(확인 시간 초과)";
                p.WaitForExit(2000);
                code = p.ExitCode;
                lock (sb) return sb.ToString().Trim();
            }
        }
        catch (Exception ex) { return "(확인 실패: " + ex.Message + ")"; }
    }

    public static Dictionary<string, object> Run(Dictionary<string, object> prm)
    {
        string tool = IsCodex(Get(prm, "tool")) ? "codex" : "claude";
        bool codex = IsCodex(tool);
        string exe = FindTool(tool);
        if (exe == null) throw new CliException(tool + " 명령을 찾지 못했습니다 (not found)");
        string runId = Get(prm, "runId"), system = Get(prm, "system"), user = Get(prm, "user"), model = Get(prm, "model");
        if (!SafeId.IsMatch(runId)) throw new CliException("잘못된 실행 id 입니다");
        if (!SafeModel.IsMatch(model)) throw new CliException("모델 이름에 쓸 수 없는 글자가 있습니다");
        int timeoutMs = 240000; int.TryParse(Get(prm, "timeoutMs"), out timeoutMs); if (timeoutMs <= 0 || timeoutMs > 900000) timeoutMs = 240000;
        lock (running) { if (cancelled.Remove(runId)) throw new CliException("취소했습니다 (cancel)"); }

        // 실행마다 빈 폴더: claude 의 작업 폴더이자 프롬프트 파일 자리. 끝나면 통째로 지운다.
        string work = Path.Combine(WorkRoot, "run_" + runId);
        Directory.CreateDirectory(work);
        try
        {
            string args, lastFile = Path.Combine(work, "last.txt");
            if (codex)
            {
                // codex exec 에는 system 자리가 따로 없어서 앞에 붙여 한 덩어리로 넣는다. "-" = stdin 에서 읽기
                args = CodexArgs + (string.IsNullOrEmpty(model) ? "" : " -m " + model) + " -o \"" + lastFile + "\" -";
                if (!string.IsNullOrEmpty(system)) user = "<지시>\n" + system + "\n</지시>\n\n" + user;
            }
            else args = LockedArgs + (string.IsNullOrEmpty(model) ? "" : " --model " + model);
            if (!codex && !string.IsNullOrEmpty(system))
            {
                string sysFile = Path.Combine(work, "system.txt");
                File.WriteAllText(sysFile, system, new UTF8Encoding(false));
                args += " --system-prompt-file \"" + sysFile + "\"";
            }
            string directExe, argPrefix;
            bool direct = ResolveDirect(exe, out directExe, out argPrefix);
            string userFile = null;
            if (!direct) { userFile = Path.Combine(work, "user.txt"); File.WriteAllText(userFile, user, new UTF8Encoding(false)); }
            // 직접 실행이면 stdin 에 UTF-8 바이트를 직접 쓰고, 아니면 cmd 로 파일 리다이렉트(.NET Framework 는 StandardInput 인코딩을 못 바꿈)
            var psi = direct
                ? new ProcessStartInfo(directExe, argPrefix + args.TrimStart()) { RedirectStandardInput = true }
                : new ProcessStartInfo("cmd.exe", "/d /s /c \"\"" + exe + "\"" + args + " < \"" + userFile + "\"\"");
            psi.UseShellExecute = false; psi.CreateNoWindow = true; psi.WorkingDirectory = work;
            psi.RedirectStandardOutput = true; psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8; psi.StandardErrorEncoding = Encoding.UTF8;
            StripClaudeEnv(psi);
            var sbOut = new StringBuilder(); var sbErr = new StringBuilder();
            var job = new Job();
            Process p;
            try { p = Process.Start(psi); job.Add(p); }
            catch (Exception ex) { job.Dispose(); throw new CliException(tool + " 를 실행하지 못했습니다", ex.Message); }
            lock (running) { running[runId] = p; jobs[runId] = job; }
            bool wasCancelled = false;
            try
            {
                lock (running) { if (cancelled.Contains(runId)) { job.Dispose(); } }
                p.OutputDataReceived += (s, e) => { if (e.Data != null) lock (sbOut) sbOut.AppendLine(e.Data); };
                p.ErrorDataReceived += (s, e) => { if (e.Data != null) lock (sbErr) sbErr.AppendLine(e.Data); };
                p.BeginOutputReadLine(); p.BeginErrorReadLine();
                if (direct)
                {
                    try
                    {
                        var bytes = Encoding.UTF8.GetBytes(user);
                        p.StandardInput.BaseStream.Write(bytes, 0, bytes.Length);
                        p.StandardInput.BaseStream.Flush();
                        p.StandardInput.Close();
                    }
                    catch { /* 취소로 이미 끝났으면 무시 */ }
                }
                if (!p.WaitForExit(timeoutMs))
                {
                    job.Dispose();
                    string err; lock (sbErr) err = sbErr.ToString();
                    throw new CliException("응답이 너무 오래 걸려 중단했습니다 (" + (timeoutMs / 1000) + "초)", err);
                }
                // 출력 파이프를 손자 프로세스가 잡고 있어도 무한정 기다리지 않는다
                job.Dispose();
                p.WaitForExit(3000);
            }
            finally
            {
                lock (running) { wasCancelled = cancelled.Remove(runId); running.Remove(runId); jobs.Remove(runId); }
                try { job.Dispose(); } catch { }
            }
            if (wasCancelled) throw new CliException("취소했습니다 (cancel)");
            string stdout, stderr; lock (sbOut) stdout = sbOut.ToString(); lock (sbErr) stderr = sbErr.ToString();
            int code; try { code = p.ExitCode; } catch { code = -1; }
            if (codex)
            {
                string last = File.Exists(lastFile) ? File.ReadAllText(lastFile, Encoding.UTF8).Trim() : "";
                if (last.Length == 0) last = stdout.Trim();
                if (code != 0 && last.Length == 0)
                    throw new CliException("codex 가 오류로 끝났습니다 (exit " + code + "): " + LastLine(stderr), stderr);
                return new Dictionary<string, object> { { "text", last }, { "stderr", stderr } };
            }
            if (code != 0 && string.IsNullOrWhiteSpace(stdout))
                throw new CliException("claude 가 오류로 끝났습니다 (exit " + code + "): " + FirstLine(stderr), stderr);

            // --output-format json: {"type":"result","result":"...", "is_error":false, ...}
            string text = stdout.Trim();
            try
            {
                var ser = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
                var j = ser.DeserializeObject(text) as Dictionary<string, object>;
                if (j != null && j.ContainsKey("result") && j["result"] != null)
                {
                    bool isErr = j.ContainsKey("is_error") && j["is_error"] is bool && (bool)j["is_error"];
                    string r = j["result"].ToString();
                    if (isErr) throw new CliException("claude 오류: " + FirstLine(r), r + "\n" + stderr);
                    text = r;
                }
            }
            catch (CliException) { throw; }
            catch { /* JSON 이 아니면 원문 그대로 */ }
            return new Dictionary<string, object> { { "text", text }, { "stderr", stderr } };
        }
        finally
        {
            try { Directory.Delete(work, true); } catch { }
        }
    }

    public static void Cancel(string runId)
    {
        if (!SafeId.IsMatch(runId ?? "")) return;
        Job j;
        lock (running)
        {
            cancelled.Add(runId);   // 아직 시작 전이면 시작하자마자 끝낸다
            if (!jobs.TryGetValue(runId, out j)) return;
        }
        try { j.Dispose(); } catch { }
    }

    static ProcessStartInfo Psi(string exe, string args)
    {
        var psi = new ProcessStartInfo("cmd.exe", "/d /s /c \"\"" + exe + "\" " + args + "\"")
        { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8 };
        StripClaudeEnv(psi);
        return psi;
    }

    static void StripClaudeEnv(ProcessStartInfo psi)
    {
        var keys = new List<string>();
        foreach (string k in psi.EnvironmentVariables.Keys) if (k.StartsWith("CLAUDE", StringComparison.OrdinalIgnoreCase)) keys.Add(k);
        foreach (var k in keys) psi.EnvironmentVariables.Remove(k);
    }

    static string Get(Dictionary<string, object> d, string k) { object v; return d.TryGetValue(k, out v) && v != null ? v.ToString() : ""; }
    // codex 는 진행 로그를 stderr 에 길게 찍고 진짜 오류는 끝에 남긴다
    static string LastLine(string s) { if (string.IsNullOrWhiteSpace(s)) return ""; var a = s.Trim().Split('\n'); return a[a.Length - 1].Trim(); }
    static string FirstLine(string s) { if (string.IsNullOrWhiteSpace(s)) return ""; var i = s.IndexOf('\n'); return (i > 0 ? s.Substring(0, i) : s).Trim(); }

    /// <summary>Windows 작업 개체: 닫으면(Dispose) 안에 든 프로세스와 그 자식·손자까지 한꺼번에 끝난다.</summary>
    sealed class Job : IDisposable
    {
        [System.Runtime.InteropServices.DllImport("kernel32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
        static extern IntPtr CreateJobObject(IntPtr a, string name);
        [System.Runtime.InteropServices.DllImport("kernel32.dll")]
        static extern bool SetInformationJobObject(IntPtr job, int cls, ref EXT info, int len);
        [System.Runtime.InteropServices.DllImport("kernel32.dll")]
        static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);
        [System.Runtime.InteropServices.DllImport("kernel32.dll")]
        static extern bool CloseHandle(IntPtr h);

        [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
        struct BASIC { public long a, b; public uint LimitFlags; public UIntPtr c, d; public uint e; public UIntPtr f; public uint g, h; }
        [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
        struct IOC { public ulong a, b, c, d, e, f; }
        [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
        struct EXT { public BASIC Basic; public IOC Io; public UIntPtr p1, p2, p3, p4; }

        IntPtr h;
        public Job()
        {
            h = CreateJobObject(IntPtr.Zero, null);
            if (h == IntPtr.Zero) return;
            var info = new EXT();
            info.Basic.LimitFlags = 0x2000;   // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            SetInformationJobObject(h, 9, ref info, System.Runtime.InteropServices.Marshal.SizeOf(typeof(EXT)));
        }
        public void Add(Process p) { if (h != IntPtr.Zero) AssignProcessToJobObject(h, p.Handle); }
        public void Dispose() { var x = h; h = IntPtr.Zero; if (x != IntPtr.Zero) CloseHandle(x); }
    }
}

/// <summary>
/// 앱 안 업데이트. GitHub Releases 의 최신 릴리스를 보고(update.check), zip 안의 "Arch Canvas.exe" 를 받아
/// 현재 EXE 와 바꿔치기한 뒤 다시 시작한다(update.apply). 바꿔치기는 앱이 끝난 뒤 작은 배치 파일이 한다.
/// 비공개 저장소면 환경변수 ARCH_CANVAS_GH_TOKEN 의 토큰을 쓴다.
/// </summary>
static class Updater
{
    public const string Repo = "svalu/arch-canvas";
    static readonly System.Text.RegularExpressions.Regex AssetName = new System.Text.RegularExpressions.Regex(@"^Arch_Canvas_v.*\.zip$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
    static string Token { get { var t = Environment.GetEnvironmentVariable("ARCH_CANVAS_GH_TOKEN"); return string.IsNullOrWhiteSpace(t) ? null : t.Trim(); } }
    static string UpdateDir { get { return Path.Combine(Bootstrap.DataDir, "update"); } }

    static HttpWebRequest Make(string url, string accept)
    {
        ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
        var req = (HttpWebRequest)WebRequest.Create(url);
        req.UserAgent = "ArchCanvas/" + Bootstrap.AppVersion;
        req.Accept = accept;
        req.Timeout = 15000; req.ReadWriteTimeout = 60000;
        req.AllowAutoRedirect = true;
        if (Token != null) req.Headers["Authorization"] = "Bearer " + Token;
        return req;
    }

    /// <summary>"1.2.3" 식 버전 비교. a > b 면 양수.</summary>
    public static int Compare(string a, string b)
    {
        var pa = (a ?? "").TrimStart('v', 'V').Split('.'); var pb = (b ?? "").TrimStart('v', 'V').Split('.');
        for (int i = 0; i < Math.Max(pa.Length, pb.Length); i++)
        {
            int x = 0, y = 0;
            if (i < pa.Length) int.TryParse(new string(pa[i].TakeWhile(char.IsDigit).ToArray()), out x);
            if (i < pb.Length) int.TryParse(new string(pb[i].TakeWhile(char.IsDigit).ToArray()), out y);
            if (x != y) return x.CompareTo(y);
        }
        return 0;
    }

    public static Dictionary<string, object> Check()
    {
        string json;
        try
        {
            var req = Make("https://api.github.com/repos/" + Repo + "/releases/latest", "application/vnd.github+json");
            using (var res = (HttpWebResponse)req.GetResponse())
            using (var sr = new StreamReader(res.GetResponseStream(), Encoding.UTF8)) json = sr.ReadToEnd();
        }
        catch (WebException ex)
        {
            var hr = ex.Response as HttpWebResponse;
            if (hr != null && (int)hr.StatusCode == 404) throw new Exception("아직 공개된 릴리스가 없습니다 (" + Repo + ")");
            if (hr != null && ((int)hr.StatusCode == 401 || (int)hr.StatusCode == 403)) throw new Exception("릴리스 정보를 볼 권한이 없습니다. 저장소가 비공개이면 공개로 바꾸거나 ARCH_CANVAS_GH_TOKEN 을 설정해야 합니다.");
            throw new Exception("업데이트 서버에 접속하지 못했습니다: " + ex.Message);
        }
        var ser = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        var j = ser.DeserializeObject(json) as Dictionary<string, object>;
        if (j == null) throw new Exception("릴리스 정보를 읽지 못했습니다");
        string tag = (j.ContainsKey("tag_name") ? j["tag_name"] as string : null) ?? "";
        string version = tag.TrimStart('v', 'V');
        Dictionary<string, object> asset = null;
        var assets = j.ContainsKey("assets") ? j["assets"] as object[] : null;
        if (assets != null)
            foreach (var o in assets)
            {
                var a = o as Dictionary<string, object>; if (a == null) continue;
                string name = a.ContainsKey("name") ? a["name"] as string : null;
                if (name != null && AssetName.IsMatch(name))
                {
                    asset = new Dictionary<string, object> {
                        { "name", name },
                        { "url", a.ContainsKey("browser_download_url") ? a["browser_download_url"] : null },
                        { "apiUrl", a.ContainsKey("url") ? a["url"] : null },
                        { "size", a.ContainsKey("size") ? a["size"] : 0 } };
                    break;
                }
            }
        return new Dictionary<string, object> {
            { "version", version }, { "current", Bootstrap.AppVersion }, { "newer", Compare(version, Bootstrap.AppVersion) > 0 && asset != null },
            { "notes", j.ContainsKey("body") ? j["body"] : "" }, { "html", j.ContainsKey("html_url") ? j["html_url"] : "" },
            { "publishedAt", j.ContainsKey("published_at") ? j["published_at"] : "" }, { "asset", asset } };
    }

    /// <summary>zip 을 받아 새 EXE 를 꺼내 두고, 앱이 끝나면 바꿔치기해 다시 시작하는 배치를 띄운다.</summary>
    public static Dictionary<string, object> Apply(Dictionary<string, object> prm, Action exit)
    {
        string url = Get(prm, "url"), apiUrl = Get(prm, "apiUrl"), name = Get(prm, "name"), version = Get(prm, "version");
        if (string.IsNullOrEmpty(url) && string.IsNullOrEmpty(apiUrl)) throw new Exception("내려받을 주소가 없습니다");
        string exe = Bootstrap.ExePath, exeDir = Path.GetDirectoryName(exe);
        // 설치 폴더에 쓸 수 있는지 먼저 확인 (Program Files 같은 곳이면 관리자 권한이 필요)
        try { string probe = Path.Combine(exeDir, ".upd_probe"); File.WriteAllText(probe, ""); File.Delete(probe); }
        catch { throw new Exception("프로그램 폴더에 쓸 수 없어 자동 업데이트를 할 수 없습니다. 관리자 권한으로 실행하거나 zip 을 직접 받아 바꿔 주십시오.\n" + exeDir); }

        Directory.CreateDirectory(UpdateDir);
        string zipPath = Path.Combine(UpdateDir, string.IsNullOrEmpty(name) ? "update.zip" : string.Join("_", name.Split(Path.GetInvalidFileNameChars())));
        string newExe = Path.Combine(UpdateDir, "Arch Canvas.new.exe");
        try { File.Delete(zipPath); } catch { } try { File.Delete(newExe); } catch { }

        // 받기: 토큰이 있으면 API 자산 주소(비공개 저장소), 아니면 공개 다운로드 주소.
        // GitHub 은 실제 파일을 다른 호스트로 302 돌려보내는데, 거기엔 Authorization 을 보내면 안 되므로 redirect 는 직접 따라간다.
        bool useApi = Token != null && !string.IsNullOrEmpty(apiUrl);
        string log = Path.Combine(UpdateDir, "update.log");
        Action<string> L = (m) => { try { File.AppendAllText(log, DateTime.Now.ToString("HH:mm:ss ") + m + Environment.NewLine); } catch { } };
        L("start " + (useApi ? apiUrl : url));
        try
        {
            string cur = useApi ? apiUrl : url; bool auth = useApi;
            for (int hop = 0; hop < 6; hop++)
            {
                var req = Make(cur, useApi ? "application/octet-stream" : "*/*");
                req.AllowAutoRedirect = false;
                if (!auth) req.Headers.Remove("Authorization");
                using (var res = (HttpWebResponse)req.GetResponse())
                {
                    int code = (int)res.StatusCode;
                    L("hop " + hop + " " + code + " " + cur);
                    if (code >= 300 && code < 400)
                    {
                        string loc = res.Headers["Location"];
                        if (string.IsNullOrEmpty(loc)) throw new Exception("이동 주소가 없습니다");
                        // 서명이 붙은 주소라 글자를 다시 인코딩하면 안 된다. 받은 그대로 쓴다
                        cur = Uri.IsWellFormedUriString(loc, UriKind.Absolute) ? loc : new Uri(new Uri(cur), loc).AbsoluteUri; auth = false; continue;
                    }
                    using (var rs = res.GetResponseStream())
                    using (var fs = File.Create(zipPath)) rs.CopyTo(fs);
                    break;
                }
            }
        }
        catch (WebException ex) { L("fail " + ex.Message); throw new Exception("업데이트 파일을 내려받지 못했습니다: " + ex.Message); }
        if (!File.Exists(zipPath)) throw new Exception("업데이트 파일을 내려받지 못했습니다");
        L("downloaded " + new FileInfo(zipPath).Length);

        // zip 안의 Arch Canvas.exe 꺼내기
        bool found = false;
        using (var zfs = File.OpenRead(zipPath))
        using (var zip = new ZipArchive(zfs, ZipArchiveMode.Read))
            foreach (var e in zip.Entries)
                if (e.FullName.EndsWith("Arch Canvas.exe", StringComparison.OrdinalIgnoreCase))
                {
                    using (var es = e.Open()) using (var fs = File.Create(newExe)) es.CopyTo(fs);
                    found = true; break;
                }
        if (!found) throw new Exception("업데이트 파일 안에 Arch Canvas.exe 가 없습니다");
        var fi = new FileInfo(newExe);
        byte[] head = new byte[2];
        using (var fs = File.OpenRead(newExe)) fs.Read(head, 0, 2);
        if (fi.Length < 500 * 1024 || head[0] != (byte)'M' || head[1] != (byte)'Z') throw new Exception("내려받은 파일이 올바른 실행 파일이 아닙니다");
        try { File.Delete(zipPath); } catch { }

        // 앱이 끝난 뒤 바꿔치기하고 다시 시작하는 배치
        int pid = Process.GetCurrentProcess().Id;
        string cmd = Path.Combine(UpdateDir, "apply.cmd");
        var sb = new StringBuilder();
        sb.AppendLine("@echo off");
        sb.AppendLine("chcp 65001 >nul");
        sb.AppendLine(":wait");
        sb.AppendLine("tasklist /FI \"PID eq " + pid + "\" 2>nul | find \"" + pid + "\" >nul && (timeout /t 1 /nobreak >nul & goto wait)");
        sb.AppendLine("set n=0");
        sb.AppendLine(":copy");
        sb.AppendLine("copy /y \"" + newExe + "\" \"" + exe + "\" >nul 2>&1 && goto ok");
        sb.AppendLine("set /a n+=1");
        sb.AppendLine("if %n% lss 20 (timeout /t 1 /nobreak >nul & goto copy)");
        sb.AppendLine("echo update failed > \"" + Path.Combine(UpdateDir, "failed.txt") + "\"");
        sb.AppendLine("start \"\" \"" + exe + "\"");
        sb.AppendLine("goto end");
        sb.AppendLine(":ok");
        sb.AppendLine("del \"" + newExe + "\" >nul 2>&1");
        sb.AppendLine("start \"\" \"" + exe + "\"");
        sb.AppendLine(":end");
        sb.AppendLine("del \"%~f0\" >nul 2>&1");
        File.WriteAllText(cmd, sb.ToString(), new UTF8Encoding(false));
        L("launch updater");
        var psi = new ProcessStartInfo("cmd.exe", "/d /c \"" + cmd + "\"") { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = UpdateDir };
        Process.Start(psi);
        if (exit != null) exit();
        return new Dictionary<string, object> { { "ok", true }, { "version", version }, { "restarting", true } };
    }

    static string Get(Dictionary<string, object> d, string k) { object v; return d.TryGetValue(k, out v) && v != null ? v.ToString() : ""; }
}

/// <summary>
/// 장면(scene) JSON → "Art::GVML ClipFormat" 패키지(DrawingML lockedCanvas). 모든 값은 EMU.
///   scene = { width, height, media:{ key: svgBase64 }, shapes:[ rect | pic | text | cxn ] }  (자세한 건 src/export/scene.js)
/// PowerPoint 가 직접 도형 여러 개를 복사할 때 만드는 패키지와 같은 구조:
///   _rels/.rels (Type=.../relationships/drawing) → clipboard/drawings/drawing1.xml (+ _rels → media/imageN.svg)
/// 그림은 svgBlip 만 넣고(PNG 없음), 연결선은 cxnSp 의 stCxn/endCxn 으로 도형 id 에 붙인다.
/// </summary>
static class PptClipboard
{
    const string NsA = "http://schemas.openxmlformats.org/drawingml/2006/main";
    const string NsR = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const string NsLc = "http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas";
    const string NsSvg = "http://schemas.microsoft.com/office/drawing/2016/SVG/main";

    public static void CopyScene(string json)
    {
        SetClipboard(BuildGvml(json));
    }

    public static void SetClipboard(byte[] gvml)
    {
        var data = new DataObject();
        data.SetData("Art::GVML ClipFormat", new MemoryStream(gvml));
        Clipboard.SetDataObject(data, true, 5, 100);
    }

    public static byte[] BuildGvml(string json)
    {
        var ser = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        var scene = (Dictionary<string, object>)ser.DeserializeObject(json);
        var media = (Dictionary<string, object>)(scene.ContainsKey("media") ? scene["media"] : new Dictionary<string, object>());
        var shapes = (object[])scene["shapes"];
        long width = L(scene, "width"), height = L(scene, "height");

        // 미디어 → rId / 파일 이름
        var mediaRel = new Dictionary<string, string>();
        var mediaFiles = new List<KeyValuePair<string, byte[]>>();
        int rid = 1;
        foreach (var kv in media)
        {
            string file = "image" + rid + ".svg";
            mediaRel[kv.Key] = "rId" + rid;
            mediaFiles.Add(new KeyValuePair<string, byte[]>(file, Convert.FromBase64String((string)kv.Value)));
            rid++;
        }

        // 도형 id → cNvPr id (연결선이 참조)
        var spId = new Dictionary<string, int>();
        int next = 2;
        foreach (Dictionary<string, object> s in shapes) spId[(string)s["id"]] = next++;

        var x = new StringBuilder();
        x.Append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>");
        x.Append("<a:graphic xmlns:a=\"" + NsA + "\" xmlns:r=\"" + NsR + "\"><a:graphicData uri=\"" + NsLc + "\"><lc:lockedCanvas xmlns:lc=\"" + NsLc + "\">");
        x.Append("<a:nvGrpSpPr><a:cNvPr id=\"0\" name=\"\"/><a:cNvGrpSpPr/></a:nvGrpSpPr>");
        x.Append("<a:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"" + width + "\" cy=\"" + height + "\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"" + width + "\" cy=\"" + height + "\"/></a:xfrm></a:grpSpPr>");

        foreach (Dictionary<string, object> s in shapes)
        {
            string t = (string)s["t"];
            int id = spId[(string)s["id"]];
            string name = Esc(S(s, "name"));
            if (t == "rect") AppendRect(x, s, id, name, false);
            else if (t == "text") AppendRect(x, s, id, name, true);
            else if (t == "pic") AppendPic(x, s, id, name, mediaRel);
            else if (t == "cxn") AppendCxn(x, s, id, name, spId);
        }
        x.Append("</lc:lockedCanvas></a:graphicData></a:graphic>");

        string types =
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
            "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
            "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
            "<Default Extension=\"svg\" ContentType=\"image/svg+xml\"/>" +
            "<Override PartName=\"/clipboard/drawings/drawing1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.drawing+xml\"/>" +
            "</Types>";
        // 주의: 루트 관계 Type 은 officeDocument 가 아니라 .../relationships/drawing 이어야 PowerPoint 가 받아준다.
        string rootRels =
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
            "<Relationship Id=\"rId1\" Type=\"" + NsR + "/drawing\" Target=\"clipboard/drawings/drawing1.xml\"/>" +
            "</Relationships>";
        var dr = new StringBuilder();
        dr.Append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">");
        int k = 1;
        foreach (var mf in mediaFiles) { dr.Append("<Relationship Id=\"rId" + k + "\" Type=\"" + NsR + "/image\" Target=\"../media/" + mf.Key + "\"/>"); k++; }
        dr.Append("</Relationships>");

        using (var ms = new MemoryStream())
        {
            using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, true))
            {
                AddBytes(zip, "[Content_Types].xml", Utf8(types));
                AddBytes(zip, "_rels/.rels", Utf8(rootRels));
                AddBytes(zip, "clipboard/drawings/drawing1.xml", Utf8(x.ToString()));
                AddBytes(zip, "clipboard/drawings/_rels/drawing1.xml.rels", Utf8(dr.ToString()));
                foreach (var mf in mediaFiles) AddBytes(zip, "clipboard/media/" + mf.Key, mf.Value);
            }
            return ms.ToArray();
        }
    }

    // 사각형(그룹) / 글상자. 글상자는 txBox="1", 채움·선 없음.
    static void AppendRect(StringBuilder x, Dictionary<string, object> s, int id, string name, bool textBox)
    {
        x.Append("<a:sp><a:nvSpPr><a:cNvPr id=\"" + id + "\" name=\"" + name + "\"/><a:cNvSpPr" + (textBox ? " txBox=\"1\"" : "") + "/></a:nvSpPr>");
        string prst = S(s, "prst") ?? "rect";
        if (prst != "rect" && prst != "roundRect" && prst != "ellipse") prst = "rect";   // 장면 JSON 값이 XML 에 그대로 들어가므로 허용 목록만
        x.Append("<a:spPr>" + Xfrm(s, 0, false, false) + "<a:prstGeom prst=\"" + prst + "\">" + (prst == "roundRect" ? "<a:avLst><a:gd name=\"adj\" fmla=\"val 12000\"/></a:avLst>" : "<a:avLst/>") + "</a:prstGeom>");
        var fill = textBox ? null : S(s, "fill");
        x.Append(fill != null ? "<a:solidFill><a:srgbClr val=\"" + Hex(fill) + "\"/></a:solidFill>" : "<a:noFill/>");
        var line = textBox ? null : s.ContainsKey("line") ? s["line"] as Dictionary<string, object> : null;
        x.Append(line != null ? Ln(line, null, null) : "<a:ln><a:noFill/></a:ln>");
        x.Append("</a:spPr>");
        var text = s.ContainsKey("text") ? s["text"] as Dictionary<string, object> : null;
        if (text != null) AppendText(x, text);
        x.Append("</a:sp>");
    }

    static void AppendText(StringBuilder x, Dictionary<string, object> t)
    {
        string anchor = S(t, "anchor") == "ctr" ? "ctr" : "t";
        string wrap = S(t, "wrap") == "none" ? "none" : "square";
        x.Append("<a:txSp><a:txBody>");
        x.Append("<a:bodyPr wrap=\"" + wrap + "\" lIns=\"" + L(t, "l") + "\" tIns=\"" + L(t, "t") + "\" rIns=\"" + L(t, "r") + "\" bIns=\"" + L(t, "b") + "\" anchor=\"" + anchor + "\" rtlCol=\"0\"><a:noAutofit/></a:bodyPr>");
        x.Append("<a:lstStyle/>");
        // 줄바꿈은 문단으로. 카드는 첫 줄(제목)만 굵게, 나머지(설명)는 bodySz/bodyColor.
        string value = S(t, "value") ?? "";
        string algn = S(t, "align") == "ctr" ? "ctr" : "l";
        bool firstOnly = B(t, "boldFirstLineOnly");
        var lines = value.Length > 0 ? value.Replace("\r", "").Split('\n') : new[] { "" };
        for (int i = 0; i < lines.Length; i++)
        {
            bool body = firstOnly && i > 0;
            long sz = body && t.ContainsKey("bodySz") ? L(t, "bodySz") : L(t, "sz");
            string color = body && S(t, "bodyColor") != null ? S(t, "bodyColor") : S(t, "color");
            bool bold = B(t, "bold") && !(firstOnly && i > 0);
            x.Append("<a:p><a:pPr algn=\"" + algn + "\"/>");
            if (lines[i].Length > 0)
            {
                x.Append("<a:r><a:rPr lang=\"ko-KR\" altLang=\"en-US\" sz=\"" + sz + "\" b=\"" + (bold ? "1" : "0") + "\" dirty=\"0\">");
                if (color != null) x.Append("<a:solidFill><a:srgbClr val=\"" + Hex(color) + "\"/></a:solidFill>");
                x.Append("</a:rPr><a:t>" + Esc(lines[i]) + "</a:t></a:r>");
            }
            x.Append("<a:endParaRPr lang=\"ko-KR\" sz=\"" + sz + "\"/></a:p>");
        }
        x.Append("</a:txBody><a:useSpRect/></a:txSp>");
    }

    // SVG 그림. PowerPoint 자신이 만드는 것과 같이 blip 에는 svgBlip 확장만 넣는다(PNG 대체 이미지 없음).
    static void AppendPic(StringBuilder x, Dictionary<string, object> s, int id, string name, Dictionary<string, string> mediaRel)
    {
        string rel;
        if (!mediaRel.TryGetValue(S(s, "media") ?? "", out rel)) return;
        x.Append("<a:pic><a:nvPicPr><a:cNvPr id=\"" + id + "\" name=\"" + name + "\"/><a:cNvPicPr><a:picLocks noChangeAspect=\"1\"/></a:cNvPicPr></a:nvPicPr>");
        x.Append("<a:blipFill><a:blip><a:extLst><a:ext uri=\"{96DAC541-7B7A-43D3-8B79-37D633B846F1}\"><asvg:svgBlip xmlns:asvg=\"" + NsSvg + "\" r:embed=\"" + rel + "\"/></a:ext></a:extLst></a:blip><a:stretch><a:fillRect/></a:stretch></a:blipFill>");
        x.Append("<a:spPr>" + Xfrm(s, 0, false, false) + "<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></a:spPr></a:pic>");
    }

    // 연결선. st/end 가 가리키는 도형이 패키지에 있으면 stCxn/endCxn 으로 붙인다.
    static void AppendCxn(StringBuilder x, Dictionary<string, object> s, int id, string name, Dictionary<string, int> spId)
    {
        x.Append("<a:cxnSp><a:nvCxnSpPr><a:cNvPr id=\"" + id + "\" name=\"" + name + "\"/><a:cNvCxnSpPr><a:cxnSpLocks/>");
        var st = s.ContainsKey("st") ? s["st"] as Dictionary<string, object> : null;
        var en = s.ContainsKey("end") ? s["end"] as Dictionary<string, object> : null;
        int sid, eid;
        if (st != null && spId.TryGetValue(S(st, "id") ?? "", out sid)) x.Append("<a:stCxn id=\"" + sid + "\" idx=\"" + L(st, "idx") + "\"/>");
        if (en != null && spId.TryGetValue(S(en, "id") ?? "", out eid)) x.Append("<a:endCxn id=\"" + eid + "\" idx=\"" + L(en, "idx") + "\"/>");
        x.Append("</a:cNvCxnSpPr></a:nvCxnSpPr>");
        x.Append("<a:spPr>" + Xfrm(s, L(s, "rot"), B(s, "flipH"), B(s, "flipV")));
        x.Append("<a:prstGeom prst=\"" + (S(s, "prst") ?? "straightConnector1") + "\">" + (s.ContainsKey("adj") ? "<a:avLst><a:gd name=\"adj1\" fmla=\"val " + L(s, "adj") + "\"/></a:avLst>" : "<a:avLst/>") + "</a:prstGeom>");
        var line = s.ContainsKey("line") ? s["line"] as Dictionary<string, object> : new Dictionary<string, object>();
        x.Append(Ln(line, S(s, "head") ?? "none", S(s, "tail") ?? "triangle"));
        x.Append("</a:spPr></a:cxnSp>");
    }

    static string Xfrm(Dictionary<string, object> s, long rot, bool flipH, bool flipV)
    {
        return "<a:xfrm" + (rot != 0 ? " rot=\"" + rot + "\"" : "") + (flipH ? " flipH=\"1\"" : "") + (flipV ? " flipV=\"1\"" : "") + ">" +
               "<a:off x=\"" + L(s, "x") + "\" y=\"" + L(s, "y") + "\"/><a:ext cx=\"" + Math.Max(0, L(s, "w")) + "\" cy=\"" + Math.Max(0, L(s, "h")) + "\"/></a:xfrm>";
    }

    static string Ln(Dictionary<string, object> line, string head, string tail)
    {
        long w = line.ContainsKey("w") ? L(line, "w") : 12700;
        var sb = new StringBuilder("<a:ln w=\"" + w + "\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\">");
        sb.Append("<a:solidFill><a:srgbClr val=\"" + Hex(S(line, "color") ?? "#232F3E") + "\"/></a:solidFill>");
        var dash = S(line, "dash");
        if (dash != null) sb.Append("<a:prstDash val=\"" + dash + "\"/>");
        sb.Append("<a:round/>");
        if (head != null) sb.Append("<a:headEnd type=\"" + head + "\" w=\"med\" len=\"med\"/>");
        if (tail != null) sb.Append("<a:tailEnd type=\"" + tail + "\" w=\"med\" len=\"med\"/>");
        sb.Append("</a:ln>");
        return sb.ToString();
    }

    static string S(Dictionary<string, object> d, string k) { object v; return d.TryGetValue(k, out v) && v != null ? v.ToString() : null; }
    static long L(Dictionary<string, object> d, string k) { object v; return d.TryGetValue(k, out v) && v != null ? (long)Math.Round(Convert.ToDouble(v, CultureInfo.InvariantCulture)) : 0; }
    static bool B(Dictionary<string, object> d, string k) { object v; return d.TryGetValue(k, out v) && v is bool && (bool)v; }
    static string Hex(string c) { return (c ?? "#000000").TrimStart('#').ToUpperInvariant(); }
    static string Esc(string s) { return (s ?? "").Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;"); }
    static byte[] Utf8(string s) { return new UTF8Encoding(false).GetBytes(s); }
    static void AddBytes(ZipArchive zip, string path, byte[] bytes)
    {
        var entry = zip.CreateEntry(path, CompressionLevel.Optimal);
        using (var st = entry.Open()) st.Write(bytes, 0, bytes.Length);
    }
}
