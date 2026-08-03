# ElkWiFi target-site contract

This structure comes from the ElkWiFi ROM and menu sources in
`../elkChat/emulator/ElkWiFi` (upstream: `hoglet67/ElkWiFi`).

## Request flow

1. `*MENU` executes `*WGET HTTP://ACORNELECTRON.NL/uefarchive/MENU E00`, then
   calls the downloaded machine code at `&0E00`.
2. `MENU` executes `*WGET -U http://acornelectron.nl/uefarchive/TITLES`.
3. A selected title executes
   `*WGET -U http://acornelectron.nl/uefarchive/<directory>/<filename><suffix>`.
4. The menu enables `*WICFS`, rewinds the in-memory UEF, and chains its first
   file.

## HTTP behavior

The ROM sends a small HTTP/1.1 request of this form:

```http
GET /uefarchive/TITLES HTTP/1.1
HOST: acornelectron.nl
User-Agent: Elk WiFi WGET
```

Compatibility requirements:

- Keep plain HTTP available on port 80. The shipped menu contains `http://`,
  and many ESP8266/ROM combinations should not be expected to follow an HTTPS
  redirect.
- Preserve the exact, case-sensitive `/uefarchive/MENU` and
  `/uefarchive/TITLES` paths.
- Return `200 OK` and the file bytes directly. Avoid authentication, cookies,
  HTML wrappers, redirects, and content compression on legacy routes.
- Send a correct `Content-Length` and close the connection after each legacy
  response. The server in this repository does both.
- UEFs must begin with `UEF File!` followed by a zero byte and must not be gzip
  compressed. The ROM's `-U` path only supports uncompressed UEF data.
- The cartridge has 128 KiB paged RAM, shared with the transfer machinery;
  payload size should be tested on hardware rather than assumed unlimited.

## TITLES binary format

`TITLES` is not text or JSON. It is a compact, page-aware binary table generated
by the original `menu/java/ProcessIndex.java` tool:

- Each title is: one directory-table index byte, filename bytes, then a suffix
  byte with bit 7 set.
- Suffix IDs map to `_RUN_BE.uef`, `_RUN_E.uef`, `_E.hq.uef`, `_BE.uef`,
  `_E.uef`, and `.uef`.
- `0xFE` means continue at the next 256-byte page.
- `0xFF` marks the end of the catalogue.
- An entry is never allowed to straddle a page boundary.

The directory and suffix lookup tables are compiled into `MENU`, so `MENU` and
`TITLES` must always be generated from the same source catalogue.

The historical format has no separate display-title field. Its menu derives the
visible name from the filename stem by removing hyphens and inserting a space
before each uppercase letter. elkNet initializes `storage/catalog/games.json` with that
exact rendering, while keeping the display title independently editable for the
web catalogue and admin interface. The filename remains the value encoded into
the cartridge-facing `TITLES` file.

Disabled games are recorded separately in `storage/catalog/disabled.json`. They remain
in the canonical archive index and on disk, but the generated `TITLES` omits
them. The web catalogue still shows them with a disabled download control. This
makes disabling fully reversible without breaking a known direct download URL.

## Deployment implication

Unmodified cartridges resolve the hard-coded hostname `acornelectron.nl`.
Deploying this code under another hostname is useful for browsers and testing,
but will not take over the cartridge traffic until DNS for that hostname points
at the service, or a replacement ROM/menu is distributed.
