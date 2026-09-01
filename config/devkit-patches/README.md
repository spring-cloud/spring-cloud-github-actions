# devkit-patches

Patches applied to a checkout of [`spring-io/spring-devkit`](https://github.com/spring-io/spring-devkit)
by the [`devkit-cli`](../../.github/actions/devkit-cli/) action before the CLI is built.

This is a **staging area for changes on their way upstream**, not a permanent fork. Every
patch here should have a corresponding upstream issue or PR, and should be deleted once
that lands and `devkit-cli` is pointed at a release containing it.

Patches are applied with `git apply --3way` in file-name order, and the build **fails
loudly** if one no longer applies — that is the signal that upstream has moved and the
patch needs rebasing or removing.

| Patch | Upstream status |
|---|---|
| `0001-broadcom-copyright-symbol.patch` | Not yet filed |
