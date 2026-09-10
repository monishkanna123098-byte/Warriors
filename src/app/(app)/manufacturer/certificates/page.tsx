"use client";

import { useApi } from "@/lib/client";
import { Card, CardHeader, Chip, Empty, Table, Td, registryTone } from "@/components/ui";

interface Cert {
  id: string;
  certNo: string;
  qty: number;
  batchNo: string;
  product: string;
  registryStatus: string;
  issuedAt: string;
}

export default function CertificatesPage() {
  const { data, loading } = useApi<{ items: Cert[] }>("/api/certificates");
  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold tracking-tight">Destruction certificates</h1>
      <Card>
        <CardHeader
          title="Certificates issued against my batches"
          subtitle="A certificate is an attestation with an enforced quantity ceiling. It is not independent proof that the units were incinerated."
        />
        {loading ? (
          <Empty>Loading…</Empty>
        ) : items.length === 0 ? (
          <Empty>No certificates issued.</Empty>
        ) : (
          <Table head={["Certificate", "Product", "Batch", "Qty", "Registry", "Issued"]}>
            {items.map((c) => (
              <tr key={c.id}>
                <Td className="font-mono text-xs">{c.certNo}</Td>
                <Td className="font-medium">{c.product}</Td>
                <Td className="font-mono">{c.batchNo}</Td>
                <Td>{c.qty}</Td>
                <Td>
                  <Chip tone={registryTone[c.registryStatus]}>{c.registryStatus}</Chip>
                </Td>
                <Td>{c.issuedAt.slice(0, 10)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
