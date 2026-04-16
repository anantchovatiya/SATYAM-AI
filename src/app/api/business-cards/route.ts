import { NextResponse } from "next/server";
import { readFile, access } from "node:fs/promises";
import path from "node:path";

const EXCEL_PATH = path.join(process.cwd(), "business-cards.xlsx");

/** GET /api/business-cards — download the Excel file */
export async function GET() {
  try {
    await access(EXCEL_PATH);
    const buffer = await readFile(EXCEL_PATH);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="business-cards.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "No business cards have been collected yet." },
      { status: 404 }
    );
  }
}
