# action-check-licenses

This action checks the licenses (npm and nuget) int he current repository and makes a comment about that

# Usage

See [action.yml](action.yml)

```yaml
steps:
- uses: neolution-ch/action-check-licenses@v1
  with:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    continueOnError: false # default
```

# License

[MIT](LICENSE.md)
