// The Local App Studio Dev NSIS hooks (M2). The installer itself is only compiled by `npm run desktop:build:dev`; these
// checks pin the guard so a later edit cannot quietly drop one of the protected folders or the normalization.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const nsh = fs.readFileSync(path.join(ROOT, 'src-tauri', 'installer', 'hooks.dev.nsh'), 'utf8');
const preinstall = nsh.slice(nsh.indexOf('!macro NSIS_HOOK_PREINSTALL'), nsh.indexOf('!macroend', nsh.indexOf('!macro NSIS_HOOK_PREINSTALL')));

describe('hooks.dev.nsh refuses folders that belong to Local App Studio', () => {
  it('normalizes $INSTDIR before comparing (full path, no trailing backslash)', () => {
    expect(nsh).toMatch(/GetFullPathName \$BdTmp \$BdOut/);
    expect(nsh).toMatch(/StrCmp \$BdTmp "\\" 0 app_dev_norm_done/);
    expect(preinstall).toMatch(/StrCpy \$BdIn "\$INSTDIR"\s+Call AppDevNormalize/);
  });

  it('checks equal, inside and containing', () => {
    expect(nsh).toMatch(/StrCmp \$BdInst \$BdOut app_dev_check_hit/);
    expect(nsh).toMatch(/StrCpy \$BdPre "\$BdOut\\"/);
    expect(nsh).toMatch(/StrCpy \$BdPre "\$BdInst\\"/);
  });

  it('protects the Local App Studio data and install folders, the Dev data folder and the recorded install location', () => {
    for (const folder of ['$APPDATA\\Local App Studio Dev', '$APPDATA\\Local App Studio', '$LOCALAPPDATA\\Local App Studio']) {
      expect(preinstall).toContain(`StrCpy $BdIn "${folder}"`);
    }
    expect(preinstall).toContain('ReadRegStr $BdIn HKCU "Software\\Local App Studio\\Local App Studio" ""');
    expect(preinstall).toContain('ReadRegStr $BdIn HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Local App Studio" "InstallLocation"');
    expect(preinstall.match(/StrCmp \$BdHit "1" app_dev_refuse/g)).toHaveLength(5);
  });

  it('strips the quotes of a registry InstallLocation', () => {
    expect(nsh).toMatch(/StrCmp \$BdTmp "\$\\"" 0 app_dev_norm_unquoted/);
  });

  it('aborts with a plain message and no em dash', () => {
    expect(preinstall).toMatch(/MessageBox MB_OK\|MB_ICONSTOP "Local App Studio Dev cannot be installed into \$INSTDIR/);
    expect(preinstall).toMatch(/Abort/);
    expect(nsh).not.toMatch(/\u2014/);
  });

  it('keeps every label unique within the file', () => {
    const labels = [...nsh.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*):\s*$/gm)].map((m) => m[1]);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('both hooks clean only the shell leftovers on a real uninstall and never the user data or browser storage', () => {
  for (const [file, product] of [['hooks.nsh', 'Local App Studio'], ['hooks.dev.nsh', 'Local App Studio Dev']]) {
    const text = fs.readFileSync(path.join(ROOT, 'src-tauri', 'installer', file), 'utf8').replace(/\r\n/g, '\n');
    const start = text.indexOf('!macro NSIS_HOOK_POSTUNINSTALL');
    const post = text.slice(start, text.indexOf('!macroend', start));
    const commands = post
      .split('\n')
      .filter((l) => !l.trim().startsWith(';'))
      .join('\n');

    it(`${file} guards against an empty BUNDLEID at compile time`, () => {
      // The template includes the hook file before it defines BUNDLEID, so the guard sits inside the macro body, before any RmDir.
      expect(post).toMatch(/^!macro NSIS_HOOK_POSTUNINSTALL\n\s+!ifndef BUNDLEID\n\s+!error "BUNDLEID is not defined"\n\s+!endif\n\s+!if "\$\{BUNDLEID\}" == ""\n\s+!error "BUNDLEID is empty"\n\s+!endif\n/);
      expect(post.indexOf('!error "BUNDLEID is empty"')).toBeLessThan(post.indexOf('RmDir'));
      expect(text.slice(0, start)).not.toContain('!error "BUNDLEID');
    });

    it(`${file} removes only the shell leftovers and the install-dir key, not on an update`, () => {
      expect(post).toMatch(/\$\{If\} \$UpdateMode <> 1/);
      expect(commands).toContain('RmDir /r "$LOCALAPPDATA\\${BUNDLEID}\\logs"');
      expect(commands).toContain('Delete "$APPDATA\\${BUNDLEID}\\.window-state.json"');
      expect(commands).toMatch(/RmDir "\$LOCALAPPDATA\\\$\{BUNDLEID\}"\n/);
      expect(commands).toMatch(/RmDir "\$APPDATA\\\$\{BUNDLEID\}"\n/);
      expect(commands).toContain('DeleteRegKey HKCU "${MANUPRODUCTKEY}"');
      expect(commands).toContain('DeleteRegKey /ifempty HKCU "${MANUKEY}"');
      // The WebView2 profile (EBWebView) is the Studio's browser storage: no recursive delete of an identifier folder itself.
      expect(commands).not.toMatch(/RmDir \/r "\$(LOCALAPPDATA|APPDATA)\\\$\{BUNDLEID\}"/);
      expect(commands).not.toContain('EBWebView');
      // Everything sits inside the not-an-update branch.
      expect(post.indexOf('RmDir')).toBeGreaterThan(post.indexOf('${If} $UpdateMode <> 1'));
      expect(post.trimEnd()).toMatch(/\$\{EndIf\}$/);
    });

    it(`${file} shows the data-kept message only outside silent mode`, () => {
      expect(post).toMatch(/MessageBox MB_OK\|MB_ICONINFORMATION "[^"]*was kept\." \/SD IDOK/);
    });

    it(`${file} never removes the ${product} data folder`, () => {
      const removals = commands.split('\n').filter((l) => /RmDir|Delete/.test(l)).join('\n');
      expect(removals).not.toContain(product);
      expect(removals).not.toMatch(/\$APPDATA\\(?!\$\{BUNDLEID\})/);
      expect(post).not.toMatch(new RegExp(String.fromCharCode(91, 0x2013, 0x2014, 93)));
    });
  }
});
