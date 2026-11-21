# Fast CSV Reader

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/feriyansyahlubis/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/feriyansyahlubis/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own **csv-reader 1.0.0** — it returns exactly
csv-reader's answer (`{columns, rows, errors}`) for every CSV input, including
every broken row, in less CPU time.

Entry for the [make.fun bounty "Read broken CSV files faster, 21 November 2026"](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
($100 USDC, 10 paid places).

## What it does

`solve.js` exports `run(input)`, where `input` is `{text, header}`. It reads the
text once, left to right, with commas and double quotes, following csv-reader
1.0.0's broken-row policy exactly:

- a U+FEFF at the very start is dropped;
- a record ends at LF or CRLF, and a line left with no characters is no record;
- outside quotes a CR not followed by LF is dropped (`stray_cr`);
- a field that opens with a quote runs to the next quote that is not doubled
  (`""` inside it is one quote, each CRLF or lone CR inside it is read as LF);
  what follows its closing quote, up to the next comma or line break, is
  appended as it stands (`quote_junk`, when the field ends); a quote that never
  closes is a literal character, and the text after it is read again as
  unquoted (`unterminated_quote`);
- a quote inside an unquoted field is a literal character;
- fields stay strings, never trimmed or converted;
- `columns` is the first record when `header` is true, else `null`; `rows`
  holds the records after it, each padded with empty strings (`short_row`) or
  cut (`long_row`) to the first record's width;
- each error is `{code, line, row}`, in the order met.

`main.ts` is the program the harness runs: it reads every case from
`/input/cases.json`, answers each with `run`, and writes
`/output/answers.json`.

## Why it is faster

csv-reader 1.0.0 reads one character at a time and builds every field up a
character at a time. This entry instead:

- splits a clean physical line (no quote, no CR) in a single native call;
- jumps unquoted fields to the next comma, LF or CR with one regex exec;
- jumps quoted fields quote to quote with `indexOf`, slicing segments
  instead of copying characters;
- counts line breaks inside quotes and normalises CRs with native regexes,
  only when the segment holds one.

No dependencies, no state kept from one case to the next, no WebAssembly or
native code. Dependency-free ES module (`solve.js`) plus a TypeScript driver
(`main.ts`), run on Node 22.

## Local check

With the bounty kit unpacked, from the kit directory:

```sh
node cli/makefun.mjs grade-local --kit . --bot /path/to/this/repo --driver process
```

or run the driver directly on the practice set and compare with the
reference answers:

```sh
mkdir -p out
MAKEFUN_INPUT_DIR=../kit/practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Licence

MIT — see [LICENSE](LICENSE).
