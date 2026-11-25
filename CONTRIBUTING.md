# Contributing to Voxelwright

Run `npm ci --prefix home` and `npm run dev --prefix home` to start the home. See the [README](README.md) for the host and other entry points.

Use a feature branch and include the issue number in the commit subject. On a Mac, install the locked dependencies in `home`, `host` and `street` with `npm ci` in each directory. Run the changed flow, its tests and the project gate from the repository root with current main merged into the branch.

    npm run check -- --ci --webgl --timeout 240

Include the results in your pull request. Outside contributions require a signed [individual contributor agreement](CLA.md) and Pavlo Zahynailo's approval. AI-written contributions are welcome. The human submitting the work signs the agreement and must have the rights it grants. The owner's agents may merge their own changes once the required checks and review pass.
