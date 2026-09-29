import type { Metadata } from "next";
import Link from "next/link";

import { requireOwner } from "@/lib/auth";
import { getServiceArea } from "@/lib/weather/queries";

import { AreaForm } from "../area-form";

export const metadata: Metadata = { title: "Service area · EcoScape Ops" };

export default async function ServiceAreaPage() {
  await requireOwner();
  const area = await getServiceArea();

  return (
    <>
      <div className="pagehead">
        <div>
          <Link className="backlink" href="/weather">
            ← Weather
          </Link>
          <h1>Service area</h1>
          {area && (
            <div className="meta">
              Now: {area.place_name} ({area.postal_code})
            </div>
          )}
        </div>
      </div>
      <AreaForm current={area?.postal_code ?? ""} cancelHref="/weather" />
    </>
  );
}
