# Third-party materials and protocol sources

VIAPP's application code is independently written and licensed under MIT. Third-party packages retain their own licenses. Package versions are recorded in `pnpm-lock.yaml`.

`scripts/licenses.mjs` collects installed runtime dependency licenses and Workbox notices into `public/licenses.txt` during every build. The npm archive of `react-remove-scroll-bar@2.3.8` omits its license file; the upstream MIT text from https://github.com/theKashey/react-remove-scroll-bar/blob/master/LICENSE is preserved in `third_party/licenses/react-remove-scroll-bar.txt` and included in the generated notices.

## ZMK Studio generated messages

`@zmkfirmware/zmk-studio-ts-client` version 0.0.18 is MIT licensed. VIAPP imports its generated message encoders, decoders and types, with an independently implemented transport and lifecycle. The upstream copyright and license are included in `public/licenses.txt`.

- https://github.com/zmkfirmware/zmk-studio-ts-client
- https://zmk.dev/docs/development/studio-rpc-protocol
- https://zmk.dev/docs/features/studio
- https://zmk.dev/docs/hardware-integration/physical-layouts
- https://github.com/zmkfirmware/zmk-studio-messages/blob/main/proto/zmk/keymap.proto
- https://github.com/zmkfirmware/zmk/blob/main/app/src/studio/keymap_subsystem.c
- https://github.com/zmkfirmware/zmk/blob/main/app/src/behavior.c

## VIA keyboard definition catalog

The numbered shards `public/definitions/00.json` through `3f.json` contain identity, matrix, layout and custom-key data extracted from `the-via/keyboards` at the revision recorded in `src/devices/via-index.json`. This separately licensed data remains GPL-3.0; its license, source revision and extraction notes are distributed in `public/definitions/LICENSE.txt` and `SOURCE.txt`, and in the application's license notices. `scripts/sync-via-catalog.mjs` reproduces the data from that revision. Custom menus are reduced to a feature flag; their implementation is not incorporated.

- https://github.com/the-via/keyboards
- https://caniusevia.com/docs/specification/
- https://caniusevia.com/docs/layouts/

VIAPP's parser, renderer, discovery and protocol code are independently implemented. Keyboard definitions are data and are never executed as scripts.

## Manufacturer definition supplement

`public/definitions/manufacturers.json` extracts USB identities, physical layouts, matrix addresses and custom-key labels from manufacturer-supplied VIA JSON files. These data retain their original rights and are not relicensed under either VIAPP's MIT license or the separate VIA catalog's GPL license. No vendor firmware, configuration application, or custom-menu implementation is bundled.

`src/devices/manufacturer-sources.json` records each exact source URL, SHA256, product label and PCB variant. `scripts/sync-manufacturer-catalog.mjs` verifies those hashes and reproduces the supplement. Source credits are also included in `public/definitions/MANUFACTURER-SOURCES.txt` and the built application's notices. Indicator settings encoded in layout bits are preserved but not exposed as physical layout controls.

- https://www.qwertykeys.com/pages/fw (Neo, QK, Owlab, Cub and other published definitions)
- https://kbdfans.com/products/tofu60-3-0
- https://kbdfans.com/products/tofu65-3-0
- https://kbdfans.com/products/tofu-tkl-r2
- https://kbdfans.com/products/tofu-pad
- https://kbdfans.com/products/tofu65-2-0-pcb
- https://github.com/ydkb/ydkb.github.io/tree/e4a225089f2d0e649278f8eeee5c3707aabcaa95/help/other-firmware/vial (original PCB author's VIA definitions)

Shared USB identities do not prove which PCB or layout is installed. VIAPP uses the reported product name and protocol version where unambiguous, otherwise it asks for a PCB selection. Catalog inclusion is not hardware acceptance. Proprietary configurators and firmware flashing are outside this supplement.

## Neo65 Cu and Neo75 Cu original tri-mode layout and protocol facts

Device identification, matrix addresses, physical layout options and original custom-key labels were transcribed from the manufacturer's definition. This is the tri-mode PCB definition, including when the PCB is used in wired mode; it is not the wired-only PCB definition.

- https://www.qwertykeys.com/pages/fw
- https://cdn.shopify.com/s/files/1/0508/8716/4061/files/Neo75.JSON?v=1738163636
- https://cdn.shopify.com/s/files/1/0508/8716/4061/files/Neo65Cu_trimode.JSON?v=1737780787
- https://www.qwertykeys.com/products/neo75cu
- https://qwertykeys.notion.site/Neo75-Cu-Build-Guide-1183d0900942800fbe0ce7807ee38e30

VIA command identifiers and encoding facts were checked against the public protocol implementations and documentation. No VIA application implementation source is incorporated into VIAPP.

- https://docs.qmk.fm/features/rawhid
- https://github.com/qmk/qmk_firmware/blob/master/quantum/via.h
- https://github.com/qmk/qmk_firmware/blob/master/quantum/via.c
- https://github.com/qmk/qmk_firmware/blob/master/quantum/keycodes.h
- https://github.com/qmk/qmk_firmware/blob/0.24.0/quantum/via.c (VIA 12 matrix-state packet)
- https://github.com/the-via/app/tree/main/src/utils/key-to-byte

## TOFU original ZMK Studio PCBs

The manufacturer's linked `openkbd` firmware configurations identify the following USB Studio PCBs. The VID is `0x9D5B`; PIDs and names come from `config/boards/shields/klink_kbd/boards/klink.conf`. Each repository's `build.yaml` enables `CONFIG_ZMK_STUDIO` with `studio-rpc-usb-uart`. Runtime layouts and behavior metadata are read from Studio, not copied or inferred from VIA JSON.

| PCB              | USB PID  | Pinned configuration                                                                                            |
| ---------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| TOFU PAD BLE     | `0x2566` | [openkbd](https://github.com/openkbd/zmk-config-tofu-pad-ble/tree/b2c5e6a65203c8a667dd139b310ddd8091ab1a2c)     |
| TOFU60 BLE 3.0   | `0x2562` | [openkbd](https://github.com/openkbd/zmk-config-tofu60-ble-3.0/tree/9a9cb0255d1dcbe7895d2d113cd2a74e17ae13bd)   |
| TOFU65 BLE 3.0   | `0x2563` | [openkbd](https://github.com/openkbd/zmk-config-tofu65-ble-3.0/tree/972294e85024da68d068dfa91f167e5657420afd)   |
| TOFU TKL BLE 3.0 | `0x2564` | [openkbd](https://github.com/openkbd/zmk-config-tofu-tkl-ble-3.0/tree/858ef9ce438fe832c82cd935650e6bbd836f424c) |

TOFU PAD's identity and protocol were also verified on original hardware. The other three registrations are source-based and still await hardware acceptance. They are not universal identifiers for future revisions; TOFULL has not been registered without a verified identity.

- https://kbdfans.com/products/tofu-pad

Names of keyboards and manufacturers identify compatible products; they do not imply sponsorship or endorsement.

## WebHID connection permissions

The distinction between persistent USB-serial-number permissions and temporary device permissions was checked against Chromium's `HidChooserContext`. Temporary permissions are revoked when the device disconnects; VIAPP requests a new grant from a user click when necessary.

- https://developer.chrome.com/docs/capabilities/hid
- https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/hid/hid_chooser_context.cc
