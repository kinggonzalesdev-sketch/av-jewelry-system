'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  bluetoothAdapterAvailable,
  bluetoothPrintingSupported,
  connectThermalPrinter,
  writeToChannel,
  type PrinterChannel,
  type PrinterHandle,
} from '@/lib/print/bluetooth-printer';
import { encodeTest, type ReceiptLanguage } from '@/lib/print/receipt-encoders';

/**
 * ONE shared Bluetooth printer connection for the whole app. You connect once
 * (from the sidebar printer control), and every print — the New Order slip and
 * anywhere else — reuses that same connection. Web Bluetooth GATT connections are
 * per-page, so holding it in a context at the shell level is what makes "connect
 * once, print many" work without reconnecting in each screen.
 */

export type PrinterContextValue = {
  supported: boolean;
  /** true = adapter on · false = Bluetooth off / no adapter · null = unknown. */
  adapterAvailable: boolean | null;
  printer: PrinterHandle | null;
  activeChannel: PrinterChannel | null;
  channelIdx: number;
  setChannelIdx: (i: number) => void;
  printLang: ReceiptLanguage;
  setPrintLang: (l: ReceiptLanguage) => void;
  connecting: boolean;
  error: string | null;
  testResult: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  testPrint: () => Promise<void>;
};

// A safe default so components work even without a provider (e.g. in unit tests
// that render a screen in isolation) — it simply reports "no printer".
const DEFAULT: PrinterContextValue = {
  supported: false,
  adapterAvailable: null,
  printer: null,
  activeChannel: null,
  channelIdx: 0,
  setChannelIdx: () => {},
  printLang: 'tspl',
  setPrintLang: () => {},
  connecting: false,
  error: null,
  testResult: null,
  connect: async () => {},
  disconnect: () => {},
  testPrint: async () => {},
};

const PrinterContext = createContext<PrinterContextValue>(DEFAULT);

export function usePrinter(): PrinterContextValue {
  return useContext(PrinterContext);
}

export function PrinterProvider({ children }: { children: ReactNode }) {
  const [supported, setSupported] = useState(false);
  const [adapterAvailable, setAdapterAvailable] = useState<boolean | null>(null);
  const [printer, setPrinter] = useState<PrinterHandle | null>(null);
  const [channelIdx, setChannelIdx] = useState(0);
  const [printLang, setPrintLang] = useState<ReceiptLanguage>('tspl');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  // Evaluate support after mount — reading the browser capability during render
  // would cause an SSR/client hydration mismatch, so it is deliberately set here.
  useEffect(() => {
    const ok = bluetoothPrintingSupported();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(ok);
    if (ok) void bluetoothAdapterAvailable().then(setAdapterAvailable);
  }, []);

  const activeChannel = printer?.channels[channelIdx] ?? printer?.channels[0] ?? null;

  const value = useMemo<PrinterContextValue>(() => {
    async function connect() {
      setConnecting(true);
      setError(null);
      setTestResult(null);
      try {
        const handle = await connectThermalPrinter();
        setPrinter(handle);
        setChannelIdx(0);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Could not connect to the printer.',
        );
      } finally {
        setConnecting(false);
      }
    }

    function disconnect() {
      setPrinter(null);
      setError(null);
      setTestResult(null);
    }

    async function testPrint() {
      const ch = printer?.channels[channelIdx] ?? printer?.channels[0] ?? null;
      if (!ch) return;
      setTestResult(null);
      try {
        await writeToChannel(ch, encodeTest(printLang));
        setTestResult(
          'Sent a test print. Did it print? If not, try another channel or format.',
        );
      } catch (err) {
        setTestResult(
          err instanceof Error ? `Write failed: ${err.message}` : 'Write failed.',
        );
      }
    }

    return {
      supported,
      adapterAvailable,
      printer,
      activeChannel,
      channelIdx,
      setChannelIdx,
      printLang,
      setPrintLang,
      connecting,
      error,
      testResult,
      connect,
      disconnect,
      testPrint,
    };
  }, [
    supported,
    adapterAvailable,
    printer,
    activeChannel,
    channelIdx,
    printLang,
    connecting,
    error,
    testResult,
  ]);

  return <PrinterContext.Provider value={value}>{children}</PrinterContext.Provider>;
}
