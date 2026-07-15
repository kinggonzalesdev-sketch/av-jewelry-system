import { InvoiceView } from '@/components/preview/invoice-view';

export default async function PreviewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ prepare?: string }>;
}) {
  const params = await searchParams;
  return <InvoiceView autoPrepare={params.prepare === '1'} />;
}
