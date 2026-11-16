# Windows coverage of the November 2026 audit

This file records which audit commits have already been taken through the Windows desktop work, so nobody repeats them. It is updated each time the Windows branch is rebased onto newer audit commits and rebuilt.

**Last update: 2026-11-17, Windows packages 0.1.6.0.**

## Audit commits covered

Audit branch `fix/audit-2026-11` up to `fb57fbe` (base `5615e1a`): 18 commits.

"Included, tests pass" means exactly this: the commit is in the code the Windows packages were built from, `svelte-check` reports no errors and the whole test suite passes on Windows 11 (183 tests), the production web build succeeds, and the desktop app built from it starts, imports, reads and resumes on Windows. It does **not** mean each fix was exercised by hand in the app; where one was, the Windows test record says so.

| Commit | Change | Windows status |
| --- | --- | --- |
| `033ce28` | fix(reader): leaving with Back keeps the reading position (BOOKS-1) | included, tests pass |
| `be6bca4` | chore(deps): npm audit fix, vite 8.3.8, vitest 5.1.0 (BOOKS-9) | included, tests pass |
| `df3fee6` | fix(epub): read XHTML chapters as XML (BOOKS-2) | included, tests pass |
| `ad2fdf7` | fix(reader): footnote links turn to their target and offer the way back (BOOKS-3) | included, tests pass |
| `535b9ad` | fix(epub): stop inflating an entry that outgrows its declared size (BOOKS-4) | included, tests pass |
| `457d2e8` | fix(epub): chapter titles come from the toc nav, first link first (BOOKS-5) | included, tests pass |
| `f32d6f6` | test(epub): type the patched ZIP as Uint8Array<ArrayBuffer> (BOOKS-4) | included, tests pass |
| `845bd3f` | fix(store): reopen IndexedDB after the browser closes the connection (BOOKS-6) | included, tests pass |
| `d55f25a` | fix(a11y): darker muted text; selected view, filter and chapter are announced (BOOKS-7) | included, tests pass |
| `a26f8da` | fix(epub): drop image maps from chapters (BOOKS-8) | included, tests pass |
| `4566c93` | fix(meta): point the social preview at skriv.ist's current image (BOOKS-10) | included, tests pass |
| `dfb2522` | style(meta): prettier on the shortened twitter:image tag (BOOKS-10) | included, tests pass |
| `80421bb` | ci(deploy): publish production only from main and record the commit (BOOKS-11) | included, tests pass |
| `6046356` | fix(app): blocked site storage no longer stalls on "Opening your library…" (BOOKS-12) | included, tests pass |
| `9966f12` | fix(headers): no-cache on the unhashed entry files (BOOKS-13) | included, tests pass |
| `43fe0a5` | fix(reader): Back waits for the queued position saves (BOOKS-1) | included, tests pass |
| `2ae9b83` | fix(reader): the way back from a link survives a chapter still loading (BOOKS-3) | included, tests pass |
| `fb57fbe` | fix(reader): a same-chapter link without a fragment turns to the chapter start (BOOKS-3) | included, tests pass |

## Windows work on top of the audit

These commits are specific to the Windows desktop app (the web reader and the macOS app keep their behaviour):

- fix(desktop): the zoom control no longer covers the page number or footer links
- feat(desktop): show and change the library folder
- fix(desktop): the library folder button no longer claims to be copying while the picker is open
- feat(calibre): read Calibre books in place in the Windows desktop app
- fix(calibre): a linked book's ID has the shape reading links accept

## Where the evidence is

The full Windows test record (steps, results, package hashes, what is still untested) is `WINDOWS-TEST-RESULTS.md` in the Windows handoff workspace. In short for Skrivist Books: library folder outside app data, Calibre read-in-place, import and reading, resume, zoom shortcuts, offline start, packaged Open With, second-file and link activation, uninstall keeping the library, and the Windows App Certification Kit were checked on 0.1.4.0–0.1.5.0; 0.1.6.0 repeats the start, import, read and resume checks on this code.

## Not covered here

Audit commits newer than `fb57fbe`; anything that only shows in a browser (PWA install and update, OPDS, Kavita and Armarium connections) beyond the automated tests; macOS.
