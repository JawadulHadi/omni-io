## What and why

<!-- One or two sentences: what changes, and the problem it solves. Link the issue. -->

## How it was tested

<!-- Commands run, screenshots for UI changes, anything a reviewer should try. -->

## Checklist

- [ ] Tests cover the change (plus the RLS integration suite if tenant data is touched)
- [ ] The ladder still never throws; any new failure mode degrades a tier and is traced
- [ ] `CHANGELOG.md` updated under **Unreleased**
- [ ] Docs or an ADR updated if behaviour, configuration or architecture changed
- [ ] No secrets, `.env` files or personal data in the diff
