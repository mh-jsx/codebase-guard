export interface KnownIndicator {
  readonly id: string;
  readonly value: string;
  readonly label: string;
}

// Split literals keep the scanner from flagging its own compiled rule table.
export const KNOWN_INDICATORS: readonly KnownIndicator[] = [
  { id: "FG-IOC-001", value: ["A9-", "8047"].join(""), label: "incident campaign marker" },
  { id: "FG-IOC-002", value: ["A9-", "9099"].join(""), label: "incident campaign marker" },
  { id: "FG-IOC-003", value: ["RPC_", "ENDPOINTS"].join(""), label: "incident payload identifier" },
  { id: "FG-IOC-004", value: ["23.27", ".13.135"].join(""), label: "known incident IP address" },
  { id: "FG-IOC-005", value: ["166.88", ".134.62"].join(""), label: "known incident IP address" },
  { id: "FG-IOC-006", value: ["/0x/", "clb"].join(""), label: "known incident endpoint" },
  { id: "FG-IOC-007", value: ["verify-", "human"].join(""), label: "incident lure marker" },
  { id: "FG-IOC-008", value: ["Catalog", "Data"].join(""), label: "incident artifact name" },
  { id: "FG-IOC-009", value: ["plist-", "cache"].join(""), label: "incident artifact name" },
  { id: "FG-IOC-010", value: ["NativeImage", "Gen"].join(""), label: "incident artifact name" },
  { id: "FG-IOC-011", value: ["cver", "sions"].join(""), label: "incident artifact name" }
];
