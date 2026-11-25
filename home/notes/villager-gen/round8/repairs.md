# Round 8: first tries, repairs and cost

Real Sonnet through `claude -p`, code arm, concurrency 3, dev server 5332, the felt kit on. Cost $1.79.

| id | role | first call s | output tokens | first try | repair reason |
| --- | --- | --- | --- | --- | --- |
| r8-01 | cook | 72.7 | 5738 | yes |  |
| r8-02 | cook | 49.6 | 5394 | yes |  |
| r8-03 | cook | 44.5 | 5430 | no, repaired | check: it is the default round body with a head on top and a hat, not its species: nothing reaches forward past the face (no snout, muzzle or beak, and the head sits on top of the body rather than ahe |
| r8-04 | gardener | 51.3 | 5572 | yes |  |
| r8-05 | gardener | 48.5 | 5368 | yes |  |
| r8-06 | gardener | 63.8 | 5730 | yes |  |
| r8-07 | tidier | 81.1 | 7592 | no, repaired | check: the tidier's feather duster plume's centre is only 57% of the head's width out from the head's centre (at least 75%); hold the duster up beside the head on a long handle, its plume clear of the |
| r8-08 | tidier | 106.8 | 11523 | yes |  |
| r8-09 | keeper | 74.9 | 7371 | yes |  |
| r8-10 | keeper | 62.5 | 6056 | no, repaired | check: it is the default round body with a head on top and a hat, not its species: nothing reaches forward past the face (no snout, muzzle or beak, and the head sits on top of the body rather than ahe |
| r8-11 | tutor | 50.5 | 4969 | yes |  |
| r8-12 | tutor | 66.4 | 6684 | yes |  |
| r8-13 | messenger | 102.4 | 7175 | yes |  |
| r8-14 | messenger | 81.9 | 6188 | no, repaired | sandbox: Cannot read properties of undefined (reading 'length') |
| r8-15 | maker | 69.5 | 7684 | yes |  |
| r8-16 | maker | 54.6 | 6580 | yes |  |
| r8-17 | maker | 72.0 | 8096 | yes |  |
| r8-18 | carer | 51.3 | 6107 | yes |  |
| r8-19 | carer | 68.2 | 7773 | yes |  |
| r8-20 | carer | 60.7 | 5791 | yes |  |
