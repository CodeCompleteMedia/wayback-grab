# wayback-grab

Download a full Wayback Machine snapshot of a domain, rewrite internal links, and ship a working offline mirror.

`wayback-grab` queries the Internet Archive's [CDX index](https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server) for every capture of a domain, downloads them in parallel, lays them out on disk in a navigable directory tree, and rewrites the HTML and CSS so internal links resolve locally. Open the resulting `index.html` in a browser and the site works offline.

## Install

```sh
npm install -g wayback-grab
```

Requires Node.js 18 or newer.

## Quick start

```sh
wayback-grab spacejam.com
```

That downloads every capture the Wayback Machine has of `spacejam.com` into `./wayback-archive/` and prints the path to the entry page when it's done.

## Usage

```
wayback-grab <domain> [options]
```

### Common workflows

Pull a specific era of a site, keeping the latest snapshot per URL within the range:

```sh
wayback-grab spacejam.com -o ./spacejam-1996 --from 19961101 --to 19991231
```

See what's archived before downloading anything:

```sh
wayback-grab spacejam.com --dry-run
```

Pull more cautiously to avoid hammering archive.org:

```sh
wayback-grab spacejam.com --concurrency 2
```

Skip the link-rewriting pass (you just want the raw files):

```sh
wayback-grab spacejam.com --no-rewrite
```

### Options

| Flag | Description | Default |
| --- | --- | --- |
| `-o, --output <dir>` | Output directory | `./wayback-archive` |
| `--from <YYYYMMDD>` | Only include snapshots on or after this date | unbounded |
| `--to <YYYYMMDD>` | Only include snapshots on or before this date | unbounded |
| `--pick <first\|last>` | Which snapshot to keep per unique URL | `last` |
| `--include-subs` | Include archived subdomains | off |
| `-c, --concurrency <n>` | Parallel downloads | `5` |
| `--no-rewrite` | Skip rewriting internal links to local paths | off |
| `--dry-run` | List URLs without downloading | off |
| `-h, --help` | Show help | — |

## How it works

1. **Index.** Query the Wayback CDX API for every capture matching the domain.
2. **Dedupe.** Group by URL and keep one snapshot per URL — by default the most recent within your date range.
3. **Download.** Fetch each capture from `web.archive.org/web/<timestamp>id_/<url>` (the `id_` flag asks the Wayback Machine for the original bytes, without its toolbar injection).
4. **Lay out.** Map each URL to a path on disk based on its hostname and pathname, with query strings folded into the filename so distinct query variants don't collide.
5. **Rewrite.** Walk every HTML and CSS file and replace absolute and `web.archive.org` URLs with relative paths into the local mirror.

## Tips

- Start with `--dry-run` to see what's actually in the archive. Old domains often have hundreds of parked-page snapshots from after the site went down — constrain `--from`/`--to` to the era you care about.
- The CDX API can be slow on busy days. If a run stalls on the index step, give it a minute before retrying.
- Re-running into the same output directory is safe — already-downloaded assets are skipped.
- The mirror is meant to be browsed locally via `file://`. Some sites with absolute paths to assets that were never archived will have broken images; that's an upstream gap, not something `wayback-grab` can fill.

## Limitations

- Dynamic content (XHR, JS-rendered pages) is preserved only to the extent the Wayback Machine archived the resulting HTML or the underlying endpoints.
- Forms, search boxes, and anything server-side won't work — it's a static snapshot.
- The Wayback Machine doesn't archive everything. Missing assets are missing assets.

## License

[MIT](LICENSE)
