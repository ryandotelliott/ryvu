# Ideas

## Reshape the review by asking for it

Let the reader tell the agent how they want to see a PR, and have the review restructure itself to match. Today the guide's shape is fixed once it's generated: chapters by purpose, every changed file accounted for.

Examples:

- "Hide all the generated files": lockfiles, snapshots, codegen output and similar drop out of both the Changes and Guide views.
- "Just show me the new evaluation pipeline": a custom view that pulls together only the relevant hunks across files, ordered so it reads top to bottom, with everything else collapsed or left out.
- Follow-ups refine the current view ("also include the tests for it", "put the schema changes first") instead of starting over.

Notes:

- Some requests are plain filters (hide paths matching a pattern, hide whole chapters) and could be applied locally without a model call. Others ("just the evaluation pipeline") need the model to pick and order hunks.
- A custom view could reuse the guide format: chapters with exact hunk references, checked by the same validation. The "every changed file must be accounted for" rule would be relaxed, but hidden files should still be listed so nothing disappears silently.
- Views are tied to a head SHA like guides are. When new commits arrive, the request could be re-run against the new snapshot.
- The original full guide stays available; a custom view is a lens on top of it, not a replacement.
