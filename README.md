# Biome: LSP panics on an untitled document when `vcs.useIgnoreFile` is enabled

Reproduction for [biomejs/biome#13257](https://github.com/biomejs/biome/issues/13257).

When an untitled (unsaved) document is opened, the Biome language server panics with
`path is expected to be under the root` if `vcs.useIgnoreFile` is on and a `.gitignore`
exists in the daemon's working directory. Editors resend the untitled tab on every restart,
so the server crashes again each time until the editor stops restarting it.

The project contains only:

- `biome.json`: VCS integration on (`clientKind: git`, `useIgnoreFile: true`)
- `.gitignore`: `dist/`, `node_modules/`
- `index.js`: one line of code

## Reproduce with a script (no editor needed)

```sh
npm install
npm run repro
```

`repro.mjs` does the following:

1. Stops any running Biome daemon of this version, so a fresh one starts with this folder as its working directory, as an editor would start it.
2. Starts `biome lsp-proxy` from this folder.
3. Sends `initialize` with this folder as the workspace, then `initialized`.
4. Sends `textDocument/didOpen` for `untitled:Untitled-1` (languageId `javascript`).

Expected output:

```text
REPRODUCED: the language server crashed.

Biome encountered an unexpected error
...
Source Location: ...\ignore-0.4.25\src\gitignore.rs:232:9
Thread Name: biome::workspace_worker_0
Message: path is expected to be under the root
...
Source Location: crates\biome_lsp\src\session.rs:1241:10
Message: called `Result::unwrap()` on an `Err` value: JoinError::Panic(..., "path is expected to be under the root", ...)
...
Source Location: crates\biome_lsp\src\session.rs:532:14
Message: Scanning task to complete successfully: JoinError::Panic(...)
```

Variations that do **not** panic:

| Change                                          | Result       |
| ----------------------------------------------- | ------------ |
| Set `vcs.enabled` to `false`                    | no panic     |
| Delete `.gitignore`                             | no panic     |
| Open `index.js` instead of an untitled document | no panic     |
| No `.git` directory                             | still panics |

## Reproduce in VS Code

1. `npm install`, then open this folder in VS Code with the Biome extension installed.
2. File → New Text File, then set the language mode to JavaScript.
3. The "Biome (…) - LSP" output channel shows the panic. After 5 restarts the extension
   reports "The biome server crashed 5 times in the last 3 minutes."

Close the untitled tab and run "Biome: Restart" to recover.

## Branches per Biome version

Each branch pins a single `@biomejs/biome` version. The "Reproduce panic" GitHub Actions
workflow runs `repro.mjs` on Windows, Ubuntu and macOS for every branch. A **green** job
means the panic **reproduced**, and a red job means the server stayed up.

| Branch        | Biome                                  | Windows    | Ubuntu         | macOS          |
| ------------- | -------------------------------------- | ---------- | -------------- | -------------- |
| `biome-2.6.6` | 2.6.6 (version in the original report) | reproduced | not reproduced | not reproduced |
| `biome-2.6.7` | 2.6.7                                  | reproduced | not reproduced | not reproduced |
| `biome-2.6.8` | 2.6.8                                  | reproduced | not reproduced | not reproduced |
| `main`        | 2.6.8 (latest)                         | reproduced | not reproduced | not reproduced |

Also reproduced locally on Windows 11 (x86_64) with VS Code 1.146.0 and Biome extension 3.8.1.

### Why only Windows

On every platform, the untitled document creates a project, and a root `Gitignore`, rooted
at the empty path `""`, while the scanner produces absolute paths. `ignore`'s
`Gitignore::strip` then removes the root prefix and a leading `/`:

- Unix (`ignore` 0.4.25 `pathutil.rs`, byte-wise `strip_prefix`): `""` matches, then the
  leading `/` is stripped, so the path becomes relative and the assert passes. Nothing
  crashes, although patterns are matched against the wrong path.
- Windows (`std::path::Path::strip_prefix`): stripping `""` leaves `C:\...` unchanged and
  there is no leading `/`, so the path still has a root and
  `assert!(!path.has_root(), "path is expected to be under the root")` panics.
