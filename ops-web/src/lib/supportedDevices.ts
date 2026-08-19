export type DeviceFamily = 'mikrotik' | 'ubiquiti' | 'omada' | 'openwrt' | 'unsupported'
export type DeviceRole = 'cpe' | 'home-router' | 'gateway' | 'ap' | 'poe-switch'
export type CapLevel = 'yes' | 'partial' | 'no' | 'poe'
export type CapKey = 'suspend' | 'passwords' | 'reboot' | 'lanConfig' | 'powerOff'

export type DeviceAction = {
  id: CapKey
  label: string
  blurb: string
}

export type DeviceCaps = Record<CapKey, { level: CapLevel; detail: string }>

export type SupportedDevice = {
  id: string
  brand: string
  name: string
  sku: string
  family: DeviceFamily
  role: DeviceRole
  recommended: boolean
  canSuspend: boolean
  streetCheap: string
  manageVia: string
  notes: string
  tags: string[]
  caps: DeviceCaps
  firmware?: string
}

export const DEVICE_ACTIONS: DeviceAction[] = [
  {
    id: 'suspend',
    label: 'Suspend / restore internet',
    blurb: 'Disable WAN, PPPoE, or firewall rule when the fee is unpaid',
  },
  {
    id: 'passwords',
    label: 'Change Wi-Fi / admin password',
    blurb: 'Yes, if a management API exists',
  },
  {
    id: 'reboot',
    label: 'Reboot',
    blurb: 'Common',
  },
  {
    id: 'lanConfig',
    label: 'Change SSID, DNS, port forwards',
    blurb: 'Often yes on ISP-grade gear',
  },
  {
    id: 'powerOff',
    label: 'Literally power off',
    blurb:
      'Rare. Most routers can reboot or disable WAN, not power themselves down. Power-off usually needs a smart plug, PoE switch, or a documented remote shutdown',
  },
]

const rosWifi: DeviceCaps = {
  suspend: { level: 'yes', detail: 'RouterOS API / REST: disable WAN, PPPoE, or drop with a firewall rule' },
  passwords: { level: 'yes', detail: 'Admin and Wi-Fi passwords over API' },
  reboot: { level: 'yes', detail: '/system reboot' },
  lanConfig: { level: 'yes', detail: 'SSID, DNS, NAT, and port forwards in RouterOS' },
  powerOff: { level: 'poe', detail: 'No self power-off. Reboot or disable WAN. Use hEX PoE (or similar) to cut PoE' },
}

const rosCpe: DeviceCaps = {
  suspend: { level: 'yes', detail: 'Disable wireless station, WAN, or firewall from RouterOS' },
  passwords: { level: 'partial', detail: 'Admin password yes. These are last-mile radios, not home Wi-Fi APs' },
  reboot: { level: 'yes', detail: 'RouterOS reboot' },
  lanConfig: { level: 'partial', detail: 'Wireless / DNS / firewall yes. Home SSID and LAN NAT usually N/A in CPE mode' },
  powerOff: { level: 'poe', detail: '24 V passive PoE — disable the injector port on a PoE switch, not the radio itself' },
}

const rosWired: DeviceCaps = {
  suspend: { level: 'yes', detail: 'Disable WAN / PPPoE or firewall — this is the right cheap gateway' },
  passwords: { level: 'partial', detail: 'Admin password yes. No Wi-Fi on this SKU' },
  reboot: { level: 'yes', detail: 'RouterOS reboot' },
  lanConfig: { level: 'partial', detail: 'DNS, DHCP, NAT, port forwards yes. No SSID' },
  powerOff: { level: 'no', detail: 'Reboot or disable WAN only. Needs a smart plug to kill mains' },
}

const uispCpe: DeviceCaps = {
  suspend: {
    level: 'yes',
    detail: 'UISP: disable wireless / station or push a blocked config. This is not a home-router WAN toggle',
  },
  passwords: { level: 'partial', detail: 'Admin password via UISP. Management SSID only — the client Wi-Fi is the hAP behind it' },
  reboot: { level: 'yes', detail: 'UISP / airOS reboot' },
  lanConfig: { level: 'partial', detail: 'Wireless, IP, and DNS on the radio. Port forwards belong on the customer router' },
  powerOff: { level: 'poe', detail: '24 V passive PoE. Cycle the switch port; the CPE cannot shut itself down' },
}

const unifiAp: DeviceCaps = {
  suspend: { level: 'partial', detail: 'An AP cannot cut WAN. Needs a UniFi gateway / controller to block the LAN or drop WAN' },
  passwords: { level: 'yes', detail: 'Wi-Fi and UniFi admin via the controller' },
  reboot: { level: 'yes', detail: 'UniFi controller reboot' },
  lanConfig: { level: 'partial', detail: 'SSID yes. DNS and port forwards live on the UniFi gateway, not the AP' },
  powerOff: { level: 'poe', detail: '802.3af PoE. Disable the switch port; the AP cannot power itself off' },
}

const unifiGateway: DeviceCaps = {
  suspend: { level: 'yes', detail: 'UniFi Network: disable WAN, firewall, or client/VLAN' },
  passwords: { level: 'partial', detail: 'Admin yes. Wi-Fi only if this unit also broadcasts (Express yes, UXG Lite no)' },
  reboot: { level: 'yes', detail: 'UniFi reboot' },
  lanConfig: { level: 'yes', detail: 'DNS, firewall, port forwards. SSID if the box is also an AP' },
  powerOff: { level: 'no', detail: 'Reboot or WAN disable. No remote mains off' },
}

export const SUPPORTED_DEVICES: SupportedDevice[] = [
  {
    id: 'hap-lite',
    brand: 'MikroTik',
    name: 'hAP lite',
    sku: 'RB941-2nD',
    family: 'mikrotik',
    role: 'home-router',
    recommended: true,
    canSuspend: true,
    streetCheap: 'Cheapest customer AP/router · ~US$25',
    manageVia: 'RouterOS API / REST',
    notes:
      'Best budget issue-out box with a real ISP API. 32 MB RAM / 16 MB flash is tight — keep config simple, or prefer hAP ax lite.',
    tags: ['hap', 'hap lite', 'rb941', 'rb941-2nd', 'home router', 'ap', 'cpe'],
    caps: rosWifi,
  },
  {
    id: 'hap-ac-lite',
    brand: 'MikroTik',
    name: 'hAP ac lite',
    sku: 'RB952Ui-5ac2nD',
    family: 'mikrotik',
    role: 'home-router',
    recommended: true,
    canSuspend: true,
    streetCheap: 'Dual-band home router · ~US$45–50',
    manageVia: 'RouterOS API / REST',
    notes: 'Still a cheap dual-band issue-out. USB + extra LAN vs hAP lite. Same suspend path as every RouterOS box.',
    tags: ['hap', 'hap ac lite', 'rb952', 'home router', 'wifi'],
    caps: rosWifi,
  },
  {
    id: 'hap-ac2',
    brand: 'MikroTik',
    name: 'hAP ac²',
    sku: 'RBD52G-5HacD2HnD-TC',
    family: 'mikrotik',
    role: 'home-router',
    recommended: true,
    canSuspend: true,
    streetCheap: 'Still cheap gigabit dual-band · ~US$55–65',
    manageVia: 'RouterOS API / REST',
    notes: 'Gigabit LAN and stronger CPU than hAP lite. Good default indoor CPE/router if the extra spend is OK.',
    tags: ['hap', 'hap ac2', 'hap ac²', 'rbd52g', 'home router'],
    caps: rosWifi,
  },
  {
    id: 'hap-ax-lite',
    brand: 'MikroTik',
    name: 'hAP ax lite',
    sku: 'L41G-2axD',
    family: 'mikrotik',
    role: 'home-router',
    recommended: true,
    canSuspend: true,
    streetCheap: 'Current cheap Wi-Fi 6 issue-out · ~US$50–60',
    manageVia: 'RouterOS API / REST',
    notes: 'Best “still cheap” replacement for hAP lite. 2.4 GHz Wi-Fi 6 only — no 5 GHz radio.',
    tags: ['hap', 'hap ax lite', 'l41g', 'wifi 6', 'home router'],
    caps: rosWifi,
  },
  {
    id: 'hex',
    brand: 'MikroTik',
    name: 'hEX',
    sku: 'RB750Gr3',
    family: 'mikrotik',
    role: 'gateway',
    recommended: true,
    canSuspend: true,
    streetCheap: 'Cheapest wired gateway · ~US$60',
    manageVia: 'RouterOS API / REST',
    notes: 'Put this indoors as the WAN/PPPoE box; hang a cheap AP off it. No Wi-Fi on the SKU.',
    tags: ['hex', 'rb750gr3', 'rb750', 'gateway', 'router', 'wired'],
    caps: rosWired,
  },
  {
    id: 'sxtsq-5ac',
    brand: 'MikroTik',
    name: 'SXTsq 5 ac',
    sku: 'RBSXTsqG-5acD',
    family: 'mikrotik',
    role: 'cpe',
    recommended: true,
    canSuspend: true,
    streetCheap: 'Cheap 5 GHz CPE dish · ~US$55',
    manageVia: 'RouterOS API / REST',
    notes: 'Customer-side airMAX-class radio with RouterOS. Suspend the station or WAN, then restore after payment.',
    tags: ['sxt', 'sxtsq', 'sxtsq 5 ac', 'cpe', 'wisp', '5ghz'],
    caps: rosCpe,
  },
  {
    id: 'lhg-5',
    brand: 'MikroTik',
    name: 'LHG 5',
    sku: 'RBLHG-5nD',
    family: 'mikrotik',
    role: 'cpe',
    recommended: true,
    canSuspend: true,
    streetCheap: 'Cheaper 5 GHz n CPE · ~US$45–55',
    manageVia: 'RouterOS API / REST',
    notes: 'Long-range dish CPE (802.11n, not ac). Fine as last-mile; slower than SXTsq 5 ac.',
    tags: ['lhg', 'lhg 5', 'rblhg', 'cpe', 'wisp', '5ghz'],
    caps: rosCpe,
  },
  {
    id: 'hex-poe',
    brand: 'MikroTik',
    name: 'hEX PoE',
    sku: 'RB960PGS',
    family: 'mikrotik',
    role: 'poe-switch',
    recommended: true,
    canSuspend: true,
    streetCheap: 'Cheap PoE-out gateway · ~US$70–80',
    manageVia: 'RouterOS API / REST (disable PoE out / WAN)',
    notes:
      'This is the power-cycle path: ether2–5 can PoE a LiteBeam / SXT. Disable that port to cut power. The CPE still cannot turn itself off.',
    tags: ['hex poe', 'rb960pgs', 'poe', 'switch', 'power cycle', 'gateway'],
    caps: {
      suspend: { level: 'yes', detail: 'Disable WAN/firewall on this box, or disable PoE out to starve the CPE' },
      passwords: { level: 'partial', detail: 'Admin password yes. No Wi-Fi' },
      reboot: { level: 'yes', detail: 'RouterOS reboot' },
      lanConfig: { level: 'partial', detail: 'DNS, VLANs, NAT yes. No SSID' },
      powerOff: { level: 'poe', detail: 'Can power-cycle attached CPE via PoE out. Cannot power itself off' },
    },
  },
  {
    id: 'litebeam-5ac-gen2',
    brand: 'Ubiquiti',
    name: 'LiteBeam 5AC Gen2',
    sku: 'LBE-5AC-Gen2',
    family: 'ubiquiti',
    role: 'cpe',
    recommended: true,
    canSuspend: true,
    streetCheap: 'Cheapest common airMAX CPE · ~US$65–70',
    manageVia: 'UISP / airOS',
    notes:
      'Wireless last-mile radio, not a home router. Suspend by disabling the station / wireless from UISP. Put a hAP behind it for Wi-Fi.',
    tags: ['litebeam', 'lbe', 'lbe-5ac-gen2', 'airmax', 'cpe', 'uisp', 'wisp'],
    caps: uispCpe,
  },
  {
    id: 'nanostation-loco-5ac',
    brand: 'Ubiquiti',
    name: 'NanoStation 5AC loco',
    sku: 'Loco5AC (NS-5ACL)',
    family: 'ubiquiti',
    role: 'cpe',
    recommended: true,
    canSuspend: true,
    streetCheap: 'Cheapest Ubiquiti CPE · ~US$49–65',
    manageVia: 'UISP / airOS',
    notes: 'Short-hop last-mile. Same UISP suspend story as LiteBeam. Official store SKU is Loco5AC.',
    tags: ['nanostation', 'loco', 'loco5ac', 'ns-5acl', 'ns5acl', 'airmax', 'cpe', 'uisp'],
    caps: uispCpe,
  },
  {
    id: 'nanostation-5ac',
    brand: 'Ubiquiti',
    name: 'NanoStation 5AC',
    sku: 'NS-5AC',
    family: 'ubiquiti',
    role: 'cpe',
    recommended: true,
    canSuspend: true,
    streetCheap: 'Two-port airMAX CPE · ~US$120–130',
    manageVia: 'UISP / airOS',
    notes: 'More money than LiteBeam/loco. Use when you want extra Ethernet on the roof, not as a cheap default.',
    tags: ['nanostation', 'ns-5ac', 'ns5ac', 'airmax', 'cpe', 'uisp'],
    caps: uispCpe,
  },
  {
    id: 'nanobeam-5ac-gen2',
    brand: 'Ubiquiti',
    name: 'NanoBeam 5AC Gen2',
    sku: 'NBE-5AC-Gen2',
    family: 'ubiquiti',
    role: 'cpe',
    recommended: true,
    canSuspend: true,
    streetCheap: 'Compact dish CPE · ~US$100',
    manageVia: 'UISP / airOS',
    notes: 'Same UISP last-mile control as LiteBeam; tighter beam, costs more.',
    tags: ['nanobeam', 'nbe', 'nbe-5ac-gen2', 'airmax', 'cpe', 'uisp'],
    caps: uispCpe,
  },
  {
    id: 'powerbeam-5ac-gen2',
    brand: 'Ubiquiti',
    name: 'PowerBeam 5AC Gen2',
    sku: 'PBE-5AC-Gen2',
    family: 'ubiquiti',
    role: 'cpe',
    recommended: true,
    canSuspend: true,
    streetCheap: 'Still-common long-shot CPE · ~US$90–110',
    manageVia: 'UISP / airOS',
    notes: 'Still in the airMAX channel. Overkill for short urban hops; use LiteBeam unless you need the dish gain.',
    tags: ['powerbeam', 'pbe', 'pbe-5ac-gen2', 'airmax', 'cpe', 'uisp'],
    caps: uispCpe,
  },
  {
    id: 'unifi-u6-lite',
    brand: 'Ubiquiti',
    name: 'U6 Lite / U6+',
    sku: 'U6-Lite / U6+',
    family: 'ubiquiti',
    role: 'ap',
    recommended: true,
    canSuspend: false,
    streetCheap: 'Cheap UniFi AP · ~US$80–130',
    manageVia: 'UniFi Network controller',
    notes:
      'Access point only. Cutting a subscriber needs a UniFi gateway (UXG Lite / Express) to drop WAN or the LAN. Do not issue an AP as the only managed CPE.',
    tags: ['unifi', 'u6', 'u6 lite', 'u6+', 'u6-plus', 'ap', 'wifi'],
    caps: unifiAp,
  },
  {
    id: 'unifi-express',
    brand: 'Ubiquiti',
    name: 'UniFi Express',
    sku: 'UX',
    family: 'ubiquiti',
    role: 'gateway',
    recommended: true,
    canSuspend: true,
    streetCheap: 'All-in-one UniFi gateway + AP · ~US$129',
    manageVia: 'UniFi Network',
    notes: 'Can suspend WAN from the controller. Pricier than a hAP; use if the site is already UniFi.',
    tags: ['unifi', 'express', 'ux', 'gateway', 'ap'],
    caps: {
      ...unifiGateway,
      passwords: { level: 'yes', detail: 'Admin and Wi-Fi via UniFi Network' },
    },
  },
  {
    id: 'uxg-lite',
    brand: 'Ubiquiti',
    name: 'UniFi Gateway Lite',
    sku: 'UXG-Lite',
    family: 'ubiquiti',
    role: 'gateway',
    recommended: true,
    canSuspend: true,
    streetCheap: 'Wired UniFi gateway · ~US$129',
    manageVia: 'UniFi Network',
    notes: 'Suspend WAN here. Pair with a UniFi AP. No Wi-Fi on the gateway.',
    tags: ['unifi', 'uxg', 'uxg lite', 'gateway'],
    caps: unifiGateway,
  },
  {
    id: 'er605',
    brand: 'TP-Link Omada',
    name: 'ER605 Omada gigabit VPN router',
    sku: 'ER605 (TL-R605)',
    family: 'omada',
    role: 'gateway',
    recommended: true,
    canSuspend: true,
    streetCheap: 'Cheap Omada gateway · ~US$50–60',
    manageVia: 'Omada SDN / Omada Cloud',
    notes:
      'This is the TP-Link that actually has an ISP-style API. Wired only. Pair with an Omada EAP if you need Wi-Fi.',
    tags: ['tplink', 'tp-link', 'omada', 'er605', 'tl-r605', 'gateway'],
    caps: {
      suspend: { level: 'yes', detail: 'Omada: disable WAN, PPPoE, or firewall when the site is controller-managed' },
      passwords: { level: 'partial', detail: 'Admin password yes. No Wi-Fi on the ER605' },
      reboot: { level: 'yes', detail: 'Omada / device reboot' },
      lanConfig: { level: 'partial', detail: 'DNS, VPN, ACL, port forwards yes. No SSID' },
      powerOff: { level: 'no', detail: 'Reboot or WAN disable only' },
    },
  },
  {
    id: 'er7206',
    brand: 'TP-Link Omada',
    name: 'ER7206 Omada gigabit VPN router',
    sku: 'ER7206 (TL-ER7206)',
    family: 'omada',
    role: 'gateway',
    recommended: true,
    canSuspend: true,
    streetCheap: 'Omada site gateway · ~US$120–150',
    manageVia: 'Omada SDN / Omada Cloud',
    firmware: '1.4.2 on this fleet · TP-Link current HWv1: 1.4.3',
    notes:
      'Stronger Omada gateway than ER605 (typically more WAN ports). Use as a site gateway, not a cheap customer CPE. Still the TP-Link path with a real ISP-style API — unlike TL-WR841N v14. Wired only. Pair with an Omada EAP if you need Wi-Fi. 1.4.2 is official for HWv1 / v1.6 (Omada 5.13). TP-Link latest on that hardware is 1.4.3; HWv2 is a separate 2.x train (currently 2.3.6).',
    tags: ['tplink', 'tp-link', 'omada', 'er7206', 'tl-er7206', 'gateway'],
    caps: {
      suspend: { level: 'yes', detail: 'Omada: disable WAN, PPPoE, or firewall when the site is controller-managed' },
      passwords: { level: 'partial', detail: 'Admin password yes. No Wi-Fi on the ER7206' },
      reboot: { level: 'yes', detail: 'Omada / device reboot' },
      lanConfig: { level: 'partial', detail: 'DNS, VPN, ACL, port forwards yes. No SSID' },
      powerOff: { level: 'no', detail: 'Reboot or WAN disable only' },
    },
  },
  {
    id: 'eap225',
    brand: 'TP-Link Omada',
    name: 'EAP225',
    sku: 'EAP225',
    family: 'omada',
    role: 'ap',
    recommended: true,
    canSuspend: false,
    streetCheap: 'Cheap Omada ceiling AP · ~US$50–70',
    manageVia: 'Omada SDN (needs controller + gateway)',
    notes:
      'Issue only with an ER605 (or other Omada gateway) plus Omada controller. The AP cannot cut internet by itself.',
    tags: ['tplink', 'tp-link', 'omada', 'eap', 'eap225', 'ap', 'wifi'],
    caps: {
      suspend: { level: 'partial', detail: 'Needs Omada gateway/controller to drop WAN or the client VLAN' },
      passwords: { level: 'yes', detail: 'SSID / PSK from Omada' },
      reboot: { level: 'yes', detail: 'Omada reboot' },
      lanConfig: { level: 'partial', detail: 'SSID yes. DNS and port forwards are on the ER605' },
      powerOff: { level: 'poe', detail: '802.3af PoE. Cycle the switch port' },
    },
  },
  {
    id: 'beryl-ax',
    brand: 'GL.iNet',
    name: 'Beryl AX',
    sku: 'GL-MT3000',
    family: 'openwrt',
    role: 'home-router',
    recommended: true,
    canSuspend: true,
    streetCheap: 'Travel / small-site OpenWrt · ~US$70',
    manageVia: 'GL.iNet HTTP API / GoodCloud, or OpenWrt/SSH',
    notes:
      'Has a real HTTP API, unlike consumer TP-Link. Fine for a handful of managed homes; not the cheapest CPE at scale.',
    tags: ['glinet', 'gl.inet', 'beryl', 'beryl ax', 'slate', 'mt3000', 'gl-mt3000', 'openwrt', 'home router'],
    caps: {
      suspend: { level: 'yes', detail: 'Disable WAN / kill switch via GL HTTP API or OpenWrt ubus/SSH' },
      passwords: { level: 'yes', detail: 'Admin and Wi-Fi via API / LuCI' },
      reboot: { level: 'yes', detail: 'API or SSH reboot' },
      lanConfig: { level: 'yes', detail: 'SSID, DNS, forwards on OpenWrt' },
      powerOff: { level: 'no', detail: 'Reboot / WAN disable. No documented remote mains off' },
    },
  },
  {
    id: 'cudy-wr3000',
    brand: 'Cudy',
    name: 'WR3000 / WR3000S',
    sku: 'WR3000 / WR3000S',
    family: 'openwrt',
    role: 'home-router',
    recommended: true,
    canSuspend: true,
    streetCheap: 'Cheap Wi-Fi 6 OpenWrt router · ~US$40–55',
    manageVia: 'OpenWrt LuCI / ubus / SSH (after official OpenWrt image)',
    notes:
      'Confident pick only once it is on OpenWrt. Stock Cudy UI is still a consumer web panel — do not count on that as an ISP API.',
    tags: ['cudy', 'wr3000', 'wr3000s', 'openwrt', 'home router', 'wifi 6'],
    caps: {
      suspend: { level: 'yes', detail: 'Yes on OpenWrt (disable WAN / firewall). Stock firmware: treat as local-only' },
      passwords: { level: 'yes', detail: 'Yes on OpenWrt. Stock: local web UI' },
      reboot: { level: 'yes', detail: 'SSH / LuCI reboot after OpenWrt' },
      lanConfig: { level: 'yes', detail: 'SSID, DNS, forwards on OpenWrt' },
      powerOff: { level: 'no', detail: 'No remote power-off' },
    },
  },
  {
    id: 'wr841n-v14',
    brand: 'TP-Link',
    name: 'TL-WR841N v14',
    sku: 'TL-WR841N v14',
    family: 'unsupported',
    role: 'home-router',
    recommended: false,
    canSuspend: false,
    streetCheap: 'Consumer junk · cheap street router, no ISP API',
    manageVia: 'Local web UI only — no RouterOS, Omada SDN, UISP, or documented ISP API',
    notes:
      'Do not issue this as managed CPE. v14 has no Omada/cloud/API path. You would have to visit the house to suspend. Use hAP lite or ER605 instead.',
    tags: ['tplink', 'tp-link', 'wr841', 'wr841n', 'tl-wr841n', 'not supported', 'consumer'],
    caps: {
      suspend: { level: 'no', detail: 'No remote WAN/PPPoE API. Local UI only if you are on site' },
      passwords: { level: 'no', detail: 'Local web UI only' },
      reboot: { level: 'no', detail: 'Local only — no management channel for the desk' },
      lanConfig: { level: 'no', detail: 'Local only' },
      powerOff: { level: 'no', detail: 'No. Would need a smart plug in the house' },
    },
  },
  {
    id: 'mw301r-v2',
    brand: 'Mercusys',
    name: 'MW301R',
    sku: 'MW301R v2',
    family: 'unsupported',
    role: 'home-router',
    recommended: false,
    canSuspend: false,
    streetCheap: 'Consumer junk · 300Mbps Wireless N home router, no ISP API',
    manageVia: 'Local web UI only — no Omada SDN, RouterOS, UISP, or documented ISP API',
    notes:
      'Do not issue as managed CPE. Mercusys is TP-Link’s sister brand; this is still a consumer box (same class as TL-WR841N). No Omada/cloud/API. OpenWrt TOH has other Mercusys SKUs (MR70X / MR80X / MR90X) but not MW301R — v2 is ~1 MB flash / 8 MB RAM, not a real OpenWrt ISP path. Disconnecting a house CPE is done on the Omada AP (their real last-mile), not on this box. Prefer hAP lite or ER605 if they need a managed home router.',
    tags: [
      'mercusys',
      'mw301r',
      'mw301r v2',
      'tp-link sister',
      'tplink',
      'not supported',
      'consumer',
    ],
    caps: {
      suspend: { level: 'no', detail: 'No remote WAN/PPPoE API. Local UI only if you are on site' },
      passwords: { level: 'no', detail: 'Local web UI only' },
      reboot: { level: 'no', detail: 'Local only — no management channel for the desk' },
      lanConfig: { level: 'no', detail: 'Local only' },
      powerOff: { level: 'no', detail: 'No. Would need a smart plug in the house' },
    },
  },
  {
    id: 'tl-r470t-v6',
    brand: 'TP-Link SafeStream',
    name: 'TL-R470T+ v6.0',
    sku: 'TL-R470T+ v6.0',
    family: 'unsupported',
    role: 'gateway',
    recommended: false,
    canSuspend: false,
    streetCheap: 'SafeStream load-balance SMB router · local web UI only',
    manageVia: 'Stock web UI / SNMP / remote HTTPS — not Omada SDN, no ISP client API',
    firmware: 'v6.0 standalone SafeStream',
    notes:
      'Not an Omada ER-series gateway. TP-Link’s Omada compatibility list covers ER605 / ER7206 / later ER models — TL-R470T+ is not on it. Official spec is web-based utility, SNMP, and IP/MAC/URL filter on the LAN NAT path. It cannot list or kick wireless CPEs associated to an Omada AP. Do not add a Manage page. Use ER7206 + Omada AP to disconnect house CPEs. Local load-balance only.',
    tags: ['tplink', 'tp-link', 'tl-r470t', 'tl-r470t+', 'r470t', 'safestream', 'load balance', 'not supported'],
    caps: {
      suspend: { level: 'no', detail: 'No Omada client-kick. LAN MAC filter only if this box is the NAT gateway — not last-mile CPE control' },
      passwords: { level: 'no', detail: 'Local web UI only' },
      reboot: { level: 'no', detail: 'Local / remote web UI — no documented desk API like ER7206' },
      lanConfig: { level: 'no', detail: 'Local load-balance and ACL only' },
      powerOff: { level: 'no', detail: 'No remote power-off' },
    },
  },
  {
    id: 'tl-r480t-v7',
    brand: 'TP-Link SafeStream',
    name: 'TL-R480T+ v7.0',
    sku: 'TL-R480T+ v7.0',
    family: 'unsupported',
    role: 'gateway',
    recommended: false,
    canSuspend: false,
    streetCheap: 'SafeStream rack load-balance router · local web UI only',
    manageVia: 'Stock web UI / SNMP v1/v2c / remote management — not Omada SDN, no ISP client API',
    firmware: 'v7.0 standalone SafeStream (TP-Link US lists End of Life)',
    notes:
      'Same class as TL-R470T+: SafeStream load-balance broadband router, not Omada. Official user guide is web utility, SNMP, MAC/URL filter — no TR-069, no controller adopt, no REST to kick AP-associated stations. Do not add a Manage page. Disconnect house CPEs from ER7206 + Omada AP, not from this box.',
    tags: ['tplink', 'tp-link', 'tl-r480t', 'tl-r480t+', 'r480t', 'safestream', 'load balance', 'not supported'],
    caps: {
      suspend: { level: 'no', detail: 'Cannot kick wireless CPE on an Omada AP. Optional LAN MAC filter only if it is the NAT gateway' },
      passwords: { level: 'no', detail: 'Local web UI only' },
      reboot: { level: 'no', detail: 'Local / remote web UI — no documented desk API like ER7206' },
      lanConfig: { level: 'no', detail: 'Local load-balance and ACL only' },
      powerOff: { level: 'no', detail: 'No remote power-off' },
    },
  },
]

export const SUPPORTED_DEVICE_COUNT = SUPPORTED_DEVICES.length

export function capLabel(level: CapLevel): string {
  if (level === 'yes') return 'Yes'
  if (level === 'partial') return 'Partial'
  if (level === 'poe') return 'Via PoE'
  return 'No'
}

export function deviceSearchBlob(device: SupportedDevice): string {
  return [
    device.brand,
    device.name,
    device.sku,
    device.firmware ?? '',
    device.manageVia,
    device.role,
    device.streetCheap,
    device.notes,
    device.family,
    ...device.tags,
  ]
    .join(' ')
    .toLowerCase()
}
