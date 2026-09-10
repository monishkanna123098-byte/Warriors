"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { licenseSlug } from "@/lib/license";

/**
 * QR to the public verify URL, so the card can be scanned off the laptop with a
 * phone (SPEC §6.6). The slug form is used because a licence number contains
 * slashes and cannot be a single path segment.
 */
export function VerifyQR({ licenseNo, batchNo, size = 148 }: { licenseNo: string; batchNo: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const [href, setHref] = useState("");

  useEffect(() => {
    const url = `${window.location.origin}/verify/${licenseSlug(licenseNo)}/${encodeURIComponent(batchNo)}`;
    setHref(url);
    QRCode.toDataURL(url, { width: size, margin: 1 })
      .then(setSrc)
      .catch(() => setSrc(null));
  }, [licenseNo, batchNo, size]);

  if (!src) return <div style={{ width: size, height: size }} className="rounded bg-slate-100" />;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={`Verify ${batchNo}`} width={size} height={size} className="rounded" />
    </a>
  );
}
