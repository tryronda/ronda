#!/usr/bin/env python3
"""One installed-app resume smoke through native WebDriver and an owned agent fixture."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


def wait(check, label, seconds=45):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        try:
            result = check()
            if result:
                return result
        except (AssertionError, OSError, ValueError, RuntimeError) as error:
            last = error
        time.sleep(.2)
    raise AssertionError(f"Timed out: {label}; last result: {last}")


def fixture(root):
    home = root / "home"
    project = root / "Recovered ' ü ; $ project"
    original = root / "moved-project"
    native_id = "resume'; ü $(touch injected)"
    title = "Native installed resume proof"
    source = home / ".claude/projects/smoke" / f"{native_id}.jsonl"
    child = source.with_suffix("") / "subagents/agent-check.jsonl"
    for path, text in ((source, title), (child, "Native installed child proof")):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"type": "user", "sessionId": native_id, "cwd": str(original),
                                   "timestamp": "2026-10-02T12:00:00Z", "message": {"content": text}})
                        + "\n", encoding="utf-8")
    project.mkdir()
    binary = root / "bin" / ("claude.exe" if os.name == "nt" else "claude")
    binary.parent.mkdir()
    marker = root / "agent.jsonl"
    rust = root / "agent.rs"
    rust.write_text('use std::{env,fs::OpenOptions,io::Write};\nfn main(){\n'
                    f'let mut f=OpenOptions::new().create(true).append(true).open({json.dumps(str(marker), ensure_ascii=False)}).unwrap();\n'
                    'writeln!(f,"{{\\\"directory\\\": {:?}, \\\"args\\\": {:?}}}",'
                    'env::current_dir().unwrap().to_string_lossy(),env::args().skip(1).collect::<Vec<_>>()).unwrap();\n'
                    'println!("Synthetic agent started");\n}\n', encoding="utf-8")
    subprocess.run(["rustc", "--crate-name", "resume_smoke_agent", str(rust), "-o", str(binary)], check=True)
    environment = {**os.environ, "RONDA_HOME": str(home), "RONDA_DB": str(root / "index.db"),
                   "TAURI_WEBVIEW_AUTOMATION": "true"}
    shell = root / "login-shell"
    if os.name != "nt":
        shell.write_text("#!/bin/sh\nexport PATH=" + "'" + str(binary.parent).replace("'", "'\"'\"'")
                         + "':/usr/bin:/bin\n[ \"$1\" = -l ] && shift\nexec /bin/sh \"$@\"\n")
        shell.chmod(0o755)
        environment["SHELL"] = str(shell)
    return home, project, original, native_id, title, binary, marker, environment, (source, child)


class Driver:
    def __init__(self, app):
        self.app, self.session = str(app), None

    def request(self, method, path, data=None):
        request = urllib.request.Request("http://127.0.0.1:4444" + path, method=method,
                    data=None if data is None else json.dumps(data).encode(),
                    headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                value = json.load(response)["value"]
        except urllib.error.HTTPError as error:
            raise RuntimeError(error.read().decode()) from error
        if isinstance(value, dict) and "error" in value:
            raise RuntimeError(value)
        return value

    def start(self):
        capabilities = ({"browserName": "webview2", "ms:edgeChromium": True,
                         "ms:edgeOptions": {"binary": self.app, "args": []}} if os.name == "nt" else
                        {"tauri:options": {"application": self.app}})
        self.session = self.request("POST", "/session", {"capabilities": {"alwaysMatch": capabilities}})["sessionId"]
        self.command("POST", "/timeouts", {"implicit": 0, "script": 30000, "pageLoad": 60000})

    def command(self, method, path, data=None):
        return self.request(method, f"/session/{self.session}" + path, data)

    def elements(self, xpath):
        return self.command("POST", "/elements", {"using": "xpath", "value": xpath})

    def element(self, xpath):
        values = wait(lambda: self.elements(xpath), xpath)
        assert len(values) == 1, (xpath, values)
        return values[0]["element-6066-11e4-a52e-4f735466cecf"]

    def click(self, xpath):
        self.command("POST", f"/element/{self.element(xpath)}/click", {})

    def text(self):
        return self.command("POST", "/execute/sync", {"script": "return document.body.innerText", "args": []})

    def contains(self, text):
        return wait(lambda: text in self.text(), text)

    def screenshot(self, path):
        path.write_bytes(base64.b64decode(self.command("GET", "/screenshot")))

    def close(self):
        if self.session:
            self.command("DELETE", "")
            self.session = None


def button(text):
    return f"//button[normalize-space(.)='{text}']"


def choose_folder(project):
    if os.name != "nt":
        window = wait(lambda: subprocess.run(["xdotool", "search", "--onlyvisible", "--name",
                        "^Choose project folder$"], capture_output=True, text=True).stdout.strip(), "GTK folder picker")
        assert "\n" not in window, "Expected one owned picker"
        subprocess.run(["xdotool", "windowactivate", "--sync", window], check=True)
        subprocess.run(["xdotool", "key", "--clearmodifiers", "ctrl+l"], check=True)
        subprocess.run(["xdotool", "type", "--clearmodifiers", "--delay", "1", str(project)], check=True)
        subprocess.run(["xdotool", "key", "--clearmodifiers", "Return"], check=True)
        # GTK's folder chooser uses Select as its default acceptance action.
        time.sleep(.5)
        subprocess.run(["xdotool", "key", "--clearmodifiers", "alt+s"], check=True)
        return
    # Inspect the native IFileDialog controls; fail with the tree rather than guessing coordinates.
    quoted = "'" + str(project).replace("'", "''") + "'"
    script = r"""
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, 'Choose project folder')
$deadline = [DateTime]::UtcNow.AddSeconds(45)
do { $window = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition); if (!$window) { Start-Sleep -Milliseconds 200 } } while (!$window -and [DateTime]::UtcNow -lt $deadline)
if (!$window) { throw 'Native folder picker was not found' }
$controls = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$edits = @($controls | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and $_.Current.Name -match '^Folder( name)?:$' })
if ($edits.Count -ne 1) { $controls | ForEach-Object { Write-Host $_.Current.Name $_.Current.AutomationId $_.Current.ControlType.ProgrammaticName }; throw 'Expected one folder entry' }
$value = $edits[0].GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
$value.SetValue(PROJECT_LITERAL)
$buttons = @($controls | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.Name.Replace('&','') -match '^(Select Folder|Open)$' })
if ($buttons.Count -ne 1) { throw 'Expected one folder acceptance button' }
$buttons[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
""".replace("PROJECT_LITERAL", quoted)
    subprocess.run(["powershell.exe", "-NoProfile", "-EncodedCommand",
                    base64.b64encode(script.encode("utf-16le")).decode()], check=True)


def smoke(app, output, self_check=False):
    root = Path(tempfile.mkdtemp(prefix="ronda-installed-smoke-"))
    home, project, original, native_id, title, binary, marker, environment, sources = fixture(root)
    original_hashes = {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in sources}
    output.mkdir(parents=True, exist_ok=True)
    logs = lambda: [json.loads(line) for line in marker.read_text(encoding="utf-8").splitlines()] if marker.exists() else []
    def verify_launches(count):
        rows = logs()
        assert len(rows) == count, rows
        for row in rows:
            assert Path(row["directory"]).resolve() == project.resolve(), row
            assert row["args"] == ["--resume", native_id], row
    if self_check:
        assert not marker.exists() and not original.exists()
        subprocess.run([str(binary), "--resume", native_id], cwd=project, check=True)
        verify_launches(1)
        assert not (project / "injected").exists()
        print("Fixture self-check passed")
        return
    profile = previous_profile = server = None
    driver = Driver(app)
    try:
        if os.name == "nt":
            profile = Path(subprocess.check_output(["powershell.exe", "-NoProfile", "-NonInteractive",
                          "-Command", "$PROFILE"], text=True).strip())
            previous_profile = profile.read_bytes() if profile.exists() else None
            profile.parent.mkdir(parents=True, exist_ok=True)
            profile.write_text("$env:PATH='" + str(binary.parent).replace("'", "''") + ";' + $env:PATH\n", encoding="utf-8-sig")
        with (output / "driver.log").open("w") as log:
            command = ([str(Path("msedgedriver.exe").resolve()), "--port=4444", "--verbose",
                        "--log-path=" + str((output / "edge.log").resolve())] if os.name == "nt" else ["tauri-driver"])
            server = subprocess.Popen(command, env=environment, stdout=log, stderr=subprocess.STDOUT)
            wait(lambda: driver.request("GET", "/status"), "native WebDriver startup")
            driver.start()
            driver.click(f"//section[@aria-label='Recent sessions']//button[contains(normalize-space(.),'{title}')]")
            driver.contains("Project folder is missing or unavailable.")
            assert not logs(), "Readiness invoked the synthetic agent"
            driver.click(button("Choose project folder"))
            choose_folder(project)
            wait(lambda: driver.elements(button("Resume")), "recovered Resume")
            assert not logs(), "Folder recovery invoked the synthetic agent"
            with sqlite3.connect(root / "index.db") as db:
                mappings = json.loads(db.execute("SELECT value FROM prefs WHERE key='resume_project_mappings'").fetchone()[0])
            assert Path(mappings[str(original)]).resolve() == project.resolve()
            driver.screenshot(output / "recovered.png")
            driver.close()
            driver.start()
            driver.click(f"//section[@aria-label='Recent sessions']//button[contains(normalize-space(.),'{title}')]")
            wait(lambda: driver.elements(button("Resume")), "persisted Resume")
            driver.click(button("Resume"))
            wait(lambda: len(logs()) == 1, "embedded agent launch")
            verify_launches(1)
            driver.screenshot(output / "embedded.png")
            for count in (2, 3):
                field = driver.element("//textarea[@aria-label='Terminal input']")
                driver.command("POST", f"/element/{field}/value", {"text": "exit\ue007"})
                driver.contains("exited")
                driver.click("//button[@title='Restart']" if count == 2 else "//button[@title='Open in system terminal']")
                wait(lambda: len(logs()) == count, "restart" if count == 2 else "external launch")
                verify_launches(count)
            disabled = binary.with_name(binary.name + ".disabled")
            binary.rename(disabled)
            driver.click("//button[@title='Restart']")
            driver.contains("MissingExecutable")
            driver.click("//button[@aria-label='Dismiss']")
            wait(lambda: "MissingExecutable" not in driver.text(), "dismiss restart error")
            driver.click("//button[@title='Open in system terminal']")
            driver.contains("MissingExecutable")
            assert len(logs()) == 3, "Unavailable agent was launched"
            disabled.rename(binary)
            driver.click("//button[@title='Stop and close terminal']")
            driver.click("//*[@role='tab' and translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='settings']")
            driver.click("//button[translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='locations']")
            driver.click("//button[starts-with(normalize-space(.),'Remove mapping for ')]")
            driver.contains("No recovered project folders.")
            with sqlite3.connect(root / "index.db") as db:
                assert json.loads(db.execute("SELECT value FROM prefs WHERE key='resume_project_mappings'").fetchone()[0]) == {}
            driver.click("//*[@role='tab' and translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='sessions']")
            driver.contains("Project folder is missing or unavailable.")
            driver.click("//section[@aria-label='Session connections']//summary")
            driver.click(button("Subagent: Native installed child proof"))
            driver.contains("Subagents cannot independently resume.")
            assert not driver.elements("//section[@aria-label='Resume readiness']//button[normalize-space(.)='Resume']")
            driver.screenshot(output / "child-restriction.png")
            assert not (project / "injected").exists()
            assert {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in sources} == original_hashes
            (output / "result.json").write_text(json.dumps({"source": os.environ.get("GITHUB_SHA"),
                "platform": os.environ.get("RUNNER_OS"), "installed_app": str(app), "launches": logs(),
                "checks": ["idle inspection", "native folder picker", "mapping persistence", "embedded resume",
                           "restart", "external launch", "launch revalidation", "Settings removal", "child restriction",
                           "literal arguments", "unchanged sources"]}, indent=2), encoding="utf-8")
            print("Installed-app resume smoke passed")
    finally:
        try:
            if driver.session:
                driver.screenshot(output / "final.png")
                (output / "final-dom.txt").write_text(driver.text(), encoding="utf-8")
                driver.close()
        finally:
            if server:
                server.terminate()
                try:
                    server.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()
            if profile:
                if previous_profile is None:
                    profile.unlink(missing_ok=True)
                else:
                    profile.write_bytes(previous_profile)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=Path)
    parser.add_argument("--output", type=Path, default=Path("resume-smoke-evidence"))
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args()
    if not args.self_check and (args.app is None or not args.app.is_file()):
        parser.error("--app must identify the installed application executable")
    smoke(args.app, args.output, args.self_check)
