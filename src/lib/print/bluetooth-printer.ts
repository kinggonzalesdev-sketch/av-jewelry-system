/**
 * Web Bluetooth direct printing to a BLE thermal/label printer (client-only).
 *
 * HONEST + REAL: it actually connects to the printer's GATT server and writes
 * bytes, and NEVER claims success it did not get. Web Bluetooth only reaches BLE
 * printers (Classic-SPP printers cannot be reached by any browser).
 *
 * Cheap BLE printers vary a lot: several may expose more than one writable
 * characteristic, and only ONE is the print-data channel. So on connect we
 * enumerate EVERY writable characteristic and let the operator Test-print each to
 * find the one that actually prints. Writes are sent in small (20-byte) chunks —
 * the safe size for the default BLE MTU that these printers often use.
 */

// Minimal Web Bluetooth typings (not in the standard DOM lib).
type GattCharacteristic = {
  uuid: string;
  properties: { write?: boolean; writeWithoutResponse?: boolean; notify?: boolean };
  writeValue(data: Uint8Array): Promise<void>;
  writeValueWithoutResponse?(data: Uint8Array): Promise<void>;
};
type GattService = {
  uuid: string;
  getCharacteristics(): Promise<GattCharacteristic[]>;
};
type GattServer = {
  connect(): Promise<GattServer>;
  getPrimaryServices(): Promise<GattService[]>;
};
type BtDevice = { name?: string | null; gatt?: GattServer };
type BluetoothLike = {
  requestDevice(options: {
    acceptAllDevices?: boolean;
    optionalServices?: (string | number)[];
  }): Promise<BtDevice>;
  /** Chromium: true when the device has a powered-on Bluetooth adapter. */
  getAvailability?(): Promise<boolean>;
};

// Well-known BLE serial/printer services (16-bit and 128-bit forms). These must
// be in optionalServices for getPrimaryServices() to reveal them.
const KNOWN_SERVICES: (string | number)[] = [
  0xffe0,
  0xff00,
  0xae30,
  0x18f0,
  0xff10,
  0xfff0,
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC/Microchip transparent UART
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
];

export type PrinterChannel = {
  /** Characteristic UUID — shown to the operator so they can identify it. */
  uuid: string;
  ch: GattCharacteristic;
  withResponse: boolean;
  withoutResponse: boolean;
};

export type PrinterHandle = {
  deviceName: string;
  /** Every writable characteristic found — the print channel is one of these. */
  channels: PrinterChannel[];
  /** Human-readable dump of the discovered services/characteristics. */
  details: string;
};

function getBluetooth(): BluetoothLike | null {
  if (typeof navigator === 'undefined') return null;
  const b = (navigator as unknown as { bluetooth?: BluetoothLike }).bluetooth;
  return b ?? null;
}

/** True only where Web Bluetooth can even be attempted (HTTPS + API present). */
export function bluetoothPrintingSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return window.isSecureContext && getBluetooth() !== null;
}

/**
 * Whether this device has a powered-on Bluetooth ADAPTER (Chromium `getAvailability`).
 *   - true  → an adapter is present and on (a printer can be chosen).
 *   - false → no adapter, or Bluetooth is turned OFF in the OS.
 *   - null  → the browser can't tell (older Chromium) — treat as "try it".
 * Distinct from `bluetoothPrintingSupported()`, which only checks the API exists.
 */
export async function bluetoothAdapterAvailable(): Promise<boolean | null> {
  const bt = getBluetooth();
  if (!bt || typeof bt.getAvailability !== 'function') return null;
  try {
    return await bt.getAvailability();
  } catch {
    return null;
  }
}

/**
 * Opens the chooser, connects GATT, and enumerates every writable characteristic.
 * Must be called from a user gesture (the browser requires it for requestDevice).
 */
export async function connectThermalPrinter(): Promise<PrinterHandle> {
  const bt = getBluetooth();
  if (!window.isSecureContext) {
    throw new Error('Open the app over HTTPS to use Bluetooth printing.');
  }
  if (!bt) {
    throw new Error(
      'This browser has no Web Bluetooth. Use Chrome or Edge on a computer, or Chrome on Android — not iPhone/Safari/Firefox.',
    );
  }

  // A quick adapter check (when the browser supports it) gives a clear message
  // instead of Chrome's raw "Bluetooth adapter not available." error.
  if ((await bluetoothAdapterAvailable()) === false) {
    throw new Error(
      "This device's Bluetooth is off or missing. Turn Bluetooth ON in the OS settings (or use a device that has Bluetooth), then try again.",
    );
  }

  let device: BtDevice;
  try {
    device = await bt.requestDevice({
      acceptAllDevices: true,
      optionalServices: KNOWN_SERVICES,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (/adapter/i.test(msg) || /not available/i.test(msg)) {
      throw new Error(
        "This device's Bluetooth is off or missing. Turn Bluetooth ON, then try again.",
      );
    }
    if (/cancel/i.test(msg) || /No device selected/i.test(msg)) {
      throw new Error('No printer selected. Tap connect again and pick your printer.');
    }
    throw err instanceof Error ? err : new Error('Could not open the printer chooser.');
  }
  const server = await device.gatt?.connect();
  if (!server) throw new Error('Could not open a GATT connection to the printer.');

  const deviceName = device.name ?? 'Printer';
  const channels: PrinterChannel[] = [];
  const lines: string[] = [`Device: ${deviceName}`];

  let services: GattService[] = [];
  try {
    services = await server.getPrimaryServices();
  } catch {
    services = [];
  }

  for (const svc of services) {
    lines.push(`Service ${svc.uuid}`);
    let chars: GattCharacteristic[] = [];
    try {
      chars = await svc.getCharacteristics();
    } catch {
      continue;
    }
    for (const ch of chars) {
      const w = ch.properties.write === true;
      const wnr = ch.properties.writeWithoutResponse === true;
      const flags = [w && 'write', wnr && 'writeNoResp', ch.properties.notify && 'notify']
        .filter(Boolean)
        .join(',');
      lines.push(`  char ${ch.uuid} [${flags || 'none'}]`);
      if (w || wnr) {
        channels.push({ uuid: ch.uuid, ch, withResponse: w, withoutResponse: wnr });
      }
    }
  }

  if (channels.length === 0) {
    throw new Error(
      'Connected, but found no writable channel. This printer may be Classic Bluetooth (SPP) only, which browsers cannot print to.',
    );
  }

  return { deviceName, channels, details: lines.join('\n') };
}

/**
 * Writes bytes to one channel in small BLE chunks. Prefers write-without-response
 * (faster, and avoids a hang when a printer never sends the write ack), falling
 * back to write-with-response.
 */
export async function writeToChannel(
  channel: PrinterChannel,
  data: Uint8Array,
  chunkSize = 20,
): Promise<void> {
  const ch = channel.ch;
  const useNoResponse =
    channel.withoutResponse && typeof ch.writeValueWithoutResponse === 'function';

  for (let offset = 0; offset < data.length; offset += chunkSize) {
    const chunk = data.subarray(offset, offset + chunkSize);
    if (useNoResponse) {
      await ch.writeValueWithoutResponse!(chunk);
    } else {
      await ch.writeValue(chunk);
    }
    await new Promise((r) => setTimeout(r, 15));
  }
}
