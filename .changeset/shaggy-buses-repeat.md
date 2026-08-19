---
"@neolution-ch/action-check-licenses": minor
---

Detect the package manager per folder instead of always running yarn

npm and pnpm projects were installed with yarn, which ignores their lockfile and resolves a different
dependency tree (so the report described packages the repository does not ship), or failed outright.
The manager is now detected from the `packageManager` field and the lockfile, and can be overridden
with the new `packageManager` input.

Every manager is asked for a hoisted `node_modules`, because the scanner walks that tree: pnpm's
default isolated layout reported 2 of 74 packages in a test fixture — a falsely clean result rather
than an error. The detected yarn flavour is also reconciled against the yarn actually on `PATH`, so a
berry project is escalated through corepack and a classic project that resolves to a berry binary
switches plans instead of passing flags the other version rejects.

Also:

- new `skipInstall` input, to scan an already installed `node_modules` when the workflow holds the
  registry credentials
- new `ignoreScripts` input, to skip dependency lifecycle scripts during install
- a folder that cannot be installed or scanned is now reported as `not scanned` with the real error,
  instead of aborting the run with a bare exit code and discarding the report for every other project
- install and scanner output is no longer swallowed: the full output goes to the run log, and URL
  credentials are stripped before anything is written to the pull request comment
- package names, licences and error text are HTML-escaped before being interpolated into the comment
- an empty scan result is reported as `not scanned` rather than rendered as a clean report
