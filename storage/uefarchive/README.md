# Legacy archive payloads

This directory maps directly to the case-sensitive `/uefarchive/` URL used by
the original ElkWiFi ROM and menu.

The complete deployment tree will look like:

```text
uefarchive/
├── MENU
├── TITLES
├── Publisher/
│   └── Game_E.uef
└── AnotherPublisher/
    └── AnotherGame_BE.uef
```

`MENU` and `TITLES` are binary files, despite having no extension. UEF files
must be uncompressed: the ROM does not support gzip-compressed UEF content.

UEF payloads are not stored in Git. Populate this directory with
`npm run import:archive` or restore it from the deployment backup.
