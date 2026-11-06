# MyPhone upstream integration

- Upstream: https://github.com/hey8v0/ST-iPhonie
- Baseline: 0.9.31, commit 0eff4e0 (local fork HEAD at merge time).
- Custom source: MyPhone 0.9.26-social.15.
- Result: MyPhone 0.9.31-social.16.

This is a three-way merge using the original 0.9.26 source as the common baseline. Upstream wardrobe, generator/theater, updated story settings, blocking UI and interception storage are retained. MyPhone social state and upstream blocking actions are connected; existing MyPhone database names and extension namespace remain independent of ST-iPhonie.

The original upstream branch is untouched. Changes are local and uncommitted on `myphone`; review in GitHub Desktop, commit to `myphone`, then publish/push when ready. No remote push, PR, or TT installation is performed by this integration.

Keep the original LICENSE and attribution. The original MyPhone source and installed TT plugin remain at social.15 until this integrated version is explicitly installed.

Validation: 122 regression tests, 315 JavaScript syntax checks and 7 isolated browser/database checks passed. No live TT or model/TTS/image API calls were used.
