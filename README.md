# action-check-licenses

This action checks the licenses (npm and nuget) int he current repository and makes a comment about that

# Usage

See [action.yml](action.yml)

```yaml
steps:
  - uses: neolution-ch/action-check-licenses@0.1.0
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

# License

[MIT](LICENSE.md)
