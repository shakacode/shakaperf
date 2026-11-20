# Contributing to ShakaPerf

Thank you for helping improve ShakaPerf.

## Formatting edited code in VS Code

Open [shakaperf.code-workspace](./shakaperf.code-workspace) and install the recommended
Prettier extension. When you save JS, JSX, TS, or TSX, VS Code passes the ranges Git
marks as modified to Prettier. Prettier can expand a range to a complete statement.
If Git supplies no ranges, VS Code skips formatting on save.

## Licensing and contributions

ShakaPerf is distributed under The ShakaPerf License (see
[LICENSE.md](./LICENSE.md)). Before we can merge your contribution, we need
you to agree to our Contributor License Agreement (see [CLA.md](./CLA.md)).

We use a sign-off model. Add a Signed-off-by line to each commit:

```bash
git commit -s -m "Your message"
```

The sign-off certifies that you have read and agree to [CLA.md](./CLA.md),
including the clause covering AI-assisted contributions: you are responsible
for any code you submit regardless of the tools used to produce it.
