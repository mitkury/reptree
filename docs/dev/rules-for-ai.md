# Rules for AI

## TLDR Context
It's an NPM package at https://www.npmjs.com/package/reptree
If you're not sure about what is the feature name for a commit - look at the list of commits in the git history or ask the user.

## Test often
After a big change or before committing, do "npm test"

## Commit messages
Short and concise.
Add "<scope>: <description>" suffix.

Scopes:
feat(name-of-a-feature) - any dedicated feature
docs - anything related to .md docs in /docs directory
test - anything related to tests
bench - anything related to benchmarks

## Publishing
1. Commit changes with descriptive message
2. Run "npm version patch" (or minor/major) to bump version
3. Push the tag to trigger the release workflow:
   ```
   git push origin v[version]  # e.g., git push origin v0.4.5
   ```
4. Run "npm publish" to publish to npm