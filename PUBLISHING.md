# Publishing Codebase Guard

Cursor uses Open VSX for public third-party extensions. Do not use a generic
file-sharing link as the primary public distribution channel.

## Permanent identity

- Display name: `Codebase Guard`
- Extension name: `frontend-guard`
- Current publisher namespace: `mh-jsx`
- Public extension ID: `mh-jsx.frontend-guard`
- Source repository: `https://github.com/mh-jsx/codebase-guard`

The publisher namespace and extension name form the permanent public identity.
Confirm the publisher namespace before the first upload. If the team chooses a
company namespace, update `publisher` in `package.json`, rebuild, and re-run all
checks before publishing.

## Account setup

The publisher must complete these steps personally because they involve an
account agreement and a secret token:

1. Create an Eclipse account with the same GitHub username used for Open VSX.
2. Sign in to https://open-vsx.org and link the Eclipse account.
3. Read and accept the Open VSX Publisher Agreement.
4. Generate a dedicated access token under Open VSX Settings > Access Tokens.
5. Keep the token in a credential manager or secret store. Never commit it,
   paste it into documentation, or send it in chat.

## Build and verify

Run from the extension project:

```text
npm test
npm run security:audit
npm run package
```

The release artifact is written to:

```text
release/codebase-guard-0.1.7.vsix
```

Inspect the package contents before every public upload.

## First publication

Use the official Open VSX CLI after authenticating securely:

```text
npx ovsx create-namespace mh-jsx
npx ovsx publish release/codebase-guard-0.1.7.vsix
```

The CLI prompts for authentication when it is not already stored. Do not put a
token directly in shell history. Creating the namespace makes the publishing
account a contributor; claiming namespace ownership separately adds verified
publisher status. Keep the public repository URL in `package.json` so registry
reviewers and users can verify the source attached to Marketplace builds.

## Verification

1. Confirm the listing metadata and license on open-vsx.org.
2. Wait for Cursor marketplace scanning and indexing.
3. In a clean Cursor profile, search for `Codebase Guard`.
4. Confirm the ID is `mh-jsx.frontend-guard`, install it, and reload Cursor.
5. Open an untrusted test workspace and verify Restricted Mode scanning,
   findings, exclusions, report export, and the no-network/no-execution boundary.

## Updates

Increment the semantic version, update `CHANGELOG.md`, rebuild, audit the VSIX,
and publish the new file under the same publisher and extension name.
