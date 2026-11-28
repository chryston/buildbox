# Release notes

BuildBox keeps no in-app changelog: a person reading these notes is deciding whether to open a
Backup they made months ago, so what matters here is what a file means and what stopped being true,
not which screen moved.

## 2026-11-28 — the export is finished (S11)

**The Handoff Pack.** `Export…` has a third tab. It puts the Drawing Set, the printed Item List,
the Cut List and the Comment Register, and eleven CSVs, into one archive under fixed names, with a
`manifest.json` that says what every file is. One scope selector drives the whole pack, so the
drawings and the tables cannot describe two different jobs.

**A Handoff Pack is not a Backup.** It cannot be opened again as your work, and BuildBox says so at
Restore rather than failing on a damaged file. It carries what you typed — Floor names, item names,
comments — and leaves the device with it. To keep your work, use `Download Backup` in the Project
Library; the pack's own note goes there.

**Drawing Sets.** The Drawing tab selects several views at once — Plan Views, Elevation Views and
Item Detail Views across Floors — and puts one on each page of one PDF, in an order you can change,
each page with its own title block and `Page n of N`. Page size and scale are set for the whole set;
orientation is chosen per page automatically and can be held. If a page will not fit at the scale
you chose, Export is disabled and the dialog names the view and offers the nearest thing that fits.
Nothing is ever clipped. Several views exported as SVG or PNG arrive as one archive, one file per
view.

**CSV contract v1.0 is frozen from this release.** The eleven tables' columns, their order and their
enum codes are published, held as bytes in the repository, and are a compatibility promise: later
minor versions only add columns at the end of a table. Renaming, removing, reordering a column or
changing a code is a major version of the contract, needs a version bump, and will be announced
here. `fixtures/export/csv/v1.0/` holds the headers, the reference rows and every published code, so
the promise can be read without opening any source file.

**What a pack remembers.** The pack and Drawing Set recipes are remembered per Project on this
device, and are never carried in a Backup — what you packed for one tradesperson is not a fact about
the Project, and a Backup should not restore someone else's pack settings onto a different job.

**Nothing changed in your data.** No schema change; no migration. Backups made before this release
open unchanged.
