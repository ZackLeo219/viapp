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

## Neo75 Cu original tri-mode layout and protocol facts

Device identification, matrix addresses, physical layout options and original custom-key labels were transcribed from the manufacturer's definition. This is the tri-mode PCB definition, including when the PCB is used in wired mode; it is not the wired-only PCB definition.

- https://www.qwertykeys.com/pages/fw
- https://cdn.shopify.com/s/files/1/0508/8716/4061/files/Neo75.JSON?v=1738163636
- https://www.qwertykeys.com/products/neo75cu
- https://qwertykeys.notion.site/Neo75-Cu-Build-Guide-1183d0900942800fbe0ce7807ee38e30

VIA command identifiers and encoding facts were checked against the public protocol implementations and documentation. No VIA application implementation source is incorporated into VIAPP.

- https://docs.qmk.fm/features/rawhid
- https://github.com/qmk/qmk_firmware/blob/master/quantum/via.h
- https://github.com/qmk/qmk_firmware/blob/master/quantum/via.c
- https://github.com/qmk/qmk_firmware/blob/0.24.0/quantum/via.c (VIA 12 matrix-state packet)
- https://github.com/the-via/app/tree/main/src/utils/key-to-byte

## TOFU PAD

The manufacturer documents the original dual-mode PCB as ZMK based. USB VID 0x9D5B / PID 0x2566 and device name `Tofu Pad BLE (USB)` were independently verified on the user's original hardware during local development. They are not claimed as published universal identifiers for future revisions.

- https://kbdfans.com/products/tofu-pad

Names of keyboards and manufacturers identify compatible products; they do not imply sponsorship or endorsement.
