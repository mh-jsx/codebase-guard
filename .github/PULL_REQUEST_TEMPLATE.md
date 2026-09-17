## What changed

<!-- Describe the focused change and why it is needed. -->

## Verification

- [ ] `npm test`
- [ ] `npm run security:audit`
- [ ] Documentation and changelog updated when public behavior changed

## Security boundary

- [ ] Does not execute workspace code, project tasks, package managers, hooks, or external binaries
- [ ] Does not add runtime process, direct Node filesystem, or network APIs
- [ ] Does not add telemetry or transmit repository data
- [ ] Does not automatically modify workspace files
- [ ] Continues to support VS Code Restricted Mode

## Scanner-rule checklist

<!-- Complete when adding or changing a rule; otherwise write "Not applicable." -->

- Rule ID and severity:
- Positive and negative tests:
- Likely false positives:
- Documentation update:
