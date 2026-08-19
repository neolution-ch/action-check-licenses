# action-check-licenses

This action checks the npm and nuget licenses in the current repository and comments the result on the pull request. It uses these two tools to
collect the licenses:

- npm: https://github.com/tmorell/license-compliance
- nuget: https://github.com/tomchavakis/nuget-license

# Usage

See [action.yml](action.yml)

```yaml
on:
  pull_request:

jobs:
  licenses:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      # the action scans the working directory, so the repository has to be checked out first
      - uses: actions/checkout@v4

      - uses: neolution-ch/action-check-licenses@v0
        with:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          continueOnBlockedFound: true
          blockedLicenses: |
            GPL
            GPL-2.0
          ignoreFolders: |
            MyUnitTestProject
            IgnoreThisFolder
```

## Inputs

| Input                    | Default  | Description                                                                                                              |
| ------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GITHUB_TOKEN`           | required | Token used to read and write the pull request comment.                                                                   |
| `continueOnBlockedFound` | `false`  | Keep going instead of failing the job when a blocked license is found.                                                   |
| `blockedLicenses`        | empty    | One license per line. Matched as an exact string, so list every spelling you care about.                                 |
| `ignoreFolders`          | empty    | One folder name per line, matched against the folder name with [minimatch](https://github.com/isaacs/minimatch).         |
| `packageManager`         | `auto`   | `auto`, `npm`, `yarn` or `pnpm`. See below.                                                                              |
| `skipInstall`            | `false`  | Scan the `node_modules` that is already present instead of installing.                                                   |
| `ignoreScripts`          | `false`  | Skip dependency lifecycle scripts during install. Recommended: license metadata never depends on them, and it is faster. |

## Package managers

The npm scanner enumerates packages by walking `node_modules`, so the action installs dependencies before scanning. With
`packageManager: auto` (the default) the manager is detected per folder, in this order:

1. the `packageManager` input, when set to something other than `auto`
2. the `packageManager` field in that folder's `package.json` (the corepack convention)
3. the lockfile — `pnpm-lock.yaml`, `yarn.lock` (v1 or berry, told apart by the lockfile header), `package-lock.json`
4. yarn, as a fallback, with a warning

Every manager is asked for a **hoisted** `node_modules` tree. This matters: pnpm's default isolated layout hides transitive
dependencies from the scanner, which would report a handful of packages instead of the whole tree — a falsely clean result rather
than an error.

The detected yarn flavour is then reconciled against the `yarn` actually on `PATH`, because the lockfile only says which one the
project wants. The runner images ship yarn 1.22, so a berry project is escalated through corepack; a classic project on a runner
where yarn resolves to berry switches to the berry plan instead of passing v1-only flags that berry rejects.

pnpm is not present on the GitHub-hosted runner images. The action tries to enable it through corepack; if that does not work,
install it yourself (for example with `pnpm/action-setup`) before this step.

Bun is detected and reported as unsupported rather than silently scanned with the wrong manager.

### When a folder cannot be installed

A folder whose install fails — a private registry without credentials, a package manager missing from the runner — is reported in
the comment as `not scanned`, with the underlying error, and the rest of the repository is still scanned and still posted. If your
workflow installs dependencies itself (because it holds the registry credentials), set `skipInstall: true` and the action will scan
what is already on disk.

# License

[MIT](LICENSE.md)
