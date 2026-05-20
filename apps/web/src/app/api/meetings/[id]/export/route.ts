import { NextRequest, NextResponse } from "next/server";
import { queryOne, queryRows } from "@/lib/db";
import { requireValidUUID } from "@/lib/api-validation";
import { apiNotFound, apiServerError } from "@/lib/api-response";
import PptxGenJS from "pptxgenjs";

type Params = { params: Promise<{ id: string }> };

interface SlideRow {
  slide_id: string;
  slide_type: string;
  title: string | null;
  body: string | null;
  image_url: string | null;
  image_caption: string | null;
  background_style: string;
  custom_data: Record<string, unknown>;
  display_order: number;
}

// Dark-first backgrounds matching the presentation cinematic style
const BG_COLORS: Record<string, string> = {
  default: "0f0f17",
  dark: "0a0a0f",
  accent: "0f1729",
  photo_bg: "050508",
};

// All styles are dark — always use light text
const isDarkBg = () => true;

function addTitleSlide(pptx: PptxGenJS, slide: SlideRow) {
  const s = pptx.addSlide();
  s.background = { color: BG_COLORS[slide.background_style] || BG_COLORS.default };
  const isDark = isDarkBg();
  const textColor = isDark ? "FFFFFF" : "1a1a2e";

  if (slide.title) {
    s.addText(slide.title, {
      x: 0.5, y: 1.5, w: 9, h: 1.5,
      fontSize: 36, bold: true, color: textColor, align: "center",
    });
  }
  if (slide.body) {
    s.addText(slide.body, {
      x: 1, y: 3.2, w: 8, h: 1.5,
      fontSize: 18, color: isDark ? "cccccc" : "666666", align: "center",
    });
  }
}

function addContentSlide(pptx: PptxGenJS, slide: SlideRow) {
  const s = pptx.addSlide();
  s.background = { color: BG_COLORS[slide.background_style] || BG_COLORS.default };
  const isDark = isDarkBg();
  const textColor = isDark ? "FFFFFF" : "1a1a2e";

  if (slide.title) {
    s.addText(slide.title, {
      x: 0.5, y: 0.4, w: 9, h: 0.8,
      fontSize: 28, bold: true, color: textColor,
    });
  }
  if (slide.body) {
    // Convert markdown-style bullets to text rows
    const lines = slide.body.split("\n").filter(Boolean);
    const rows = lines.map((line) => {
      const text = line.replace(/^[-*]\s*/, "");
      const isBullet = line.match(/^[-*]\s/);
      return {
        text,
        options: {
          fontSize: 16,
          color: isDark ? "dddddd" : "333333",
          bullet: isBullet ? { type: "bullet" as const } : undefined,
          breakLine: true,
        },
      };
    });
    s.addText(rows, { x: 0.8, y: 1.5, w: 8.4, h: 4 });
  }
}

function addStatsSlide(pptx: PptxGenJS, slide: SlideRow) {
  const s = pptx.addSlide();
  s.background = { color: BG_COLORS[slide.background_style] || BG_COLORS.default };
  const isDark = isDarkBg();
  const textColor = isDark ? "FFFFFF" : "1a1a2e";

  if (slide.title) {
    s.addText(slide.title, {
      x: 0.5, y: 0.4, w: 9, h: 0.8,
      fontSize: 28, bold: true, color: textColor, align: "center",
    });
  }

  const stats = (slide.custom_data?.stats as Array<{ label: string; value: string; highlight?: boolean }>) || [];
  if (stats.length > 0) {
    const colW = 8 / Math.min(stats.length, 4);
    stats.forEach((stat, i) => {
      const x = 1 + i * colW;
      s.addText(stat.value, {
        x, y: 2, w: colW, h: 1,
        fontSize: 36, bold: true, align: "center",
        color: stat.highlight ? "2563eb" : textColor,
      });
      s.addText(stat.label, {
        x, y: 3, w: colW, h: 0.6,
        fontSize: 14, align: "center",
        color: isDark ? "aaaaaa" : "666666",
      });
    });
  }
}

function addPhotoSlide(pptx: PptxGenJS, slide: SlideRow) {
  const s = pptx.addSlide();
  s.background = { color: BG_COLORS[slide.background_style] || BG_COLORS.default };
  const isDark = isDarkBg();
  const textColor = isDark ? "FFFFFF" : "1a1a2e";

  if (slide.title) {
    s.addText(slide.title, {
      x: 0.5, y: 0.3, w: 9, h: 0.7,
      fontSize: 24, bold: true, color: textColor, align: "center",
    });
  }

  if (slide.image_url) {
    s.addImage({
      path: slide.image_url,
      x: 1.5, y: 1.2, w: 7, h: 4,
      sizing: { type: "contain", w: 7, h: 4 },
    });
  }

  if (slide.image_caption) {
    s.addText(slide.image_caption, {
      x: 1, y: 5.3, w: 8, h: 0.5,
      fontSize: 12, italic: true, align: "center",
      color: isDark ? "999999" : "888888",
    });
  }
}

function addTwoColumnSlide(pptx: PptxGenJS, slide: SlideRow) {
  const s = pptx.addSlide();
  s.background = { color: BG_COLORS[slide.background_style] || BG_COLORS.default };
  const isDark = isDarkBg();
  const textColor = isDark ? "FFFFFF" : "1a1a2e";
  const bodyColor = isDark ? "dddddd" : "333333";

  if (slide.title) {
    s.addText(slide.title, {
      x: 0.5, y: 0.4, w: 9, h: 0.8,
      fontSize: 28, bold: true, color: textColor,
    });
  }

  const left = (slide.custom_data?.left_content as string) || "";
  const right = (slide.custom_data?.right_content as string) || "";

  s.addText(left, { x: 0.5, y: 1.5, w: 4.3, h: 4, fontSize: 14, color: bodyColor });
  s.addText(right, { x: 5.2, y: 1.5, w: 4.3, h: 4, fontSize: 14, color: bodyColor });
}

function addQuoteSlide(pptx: PptxGenJS, slide: SlideRow) {
  const s = pptx.addSlide();
  s.background = { color: BG_COLORS[slide.background_style] || BG_COLORS.default };
  const isDark = isDarkBg();

  if (slide.body) {
    s.addText(`"${slide.body}"`, {
      x: 1, y: 1.5, w: 8, h: 2.5,
      fontSize: 24, italic: true, align: "center",
      color: isDark ? "FFFFFF" : "1a1a2e",
    });
  }

  if (slide.title) {
    s.addText(`- ${slide.title}`, {
      x: 1, y: 4.2, w: 8, h: 0.6,
      fontSize: 16, align: "center",
      color: isDark ? "aaaaaa" : "666666",
    });
  }
}

// GET /api/meetings/[id]/export — generate PPTX
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    requireValidUUID(id, "meeting");

    const meeting = await queryOne<{ title: string; meeting_date: string | null }>(
      `SELECT title, meeting_date FROM ops.trapper_meetings WHERE meeting_id = $1`,
      [id]
    );
    if (!meeting) return apiNotFound("meeting", id);

    const slides = await queryRows<SlideRow>(
      `SELECT slide_id, slide_type, title, body, image_url, image_caption,
              background_style, custom_data, display_order
       FROM ops.meeting_slides WHERE meeting_id = $1
       ORDER BY display_order ASC`,
      [id]
    );

    const pptx = new PptxGenJS();
    pptx.title = meeting.title;
    pptx.layout = "LAYOUT_16x9";

    const handlers: Record<string, (p: PptxGenJS, s: SlideRow) => void> = {
      title: addTitleSlide,
      content: addContentSlide,
      stats: addStatsSlide,
      photo: addPhotoSlide,
      two_column: addTwoColumnSlide,
      quote: addQuoteSlide,
    };

    for (const slide of slides) {
      const handler = handlers[slide.slide_type] || addContentSlide;
      handler(pptx, slide);
    }

    const buffer = await pptx.write({ outputType: "nodebuffer" }) as unknown as ArrayBuffer;
    const filename = `${meeting.title.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "_")}.pptx`;

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === "ApiError") throw error;
    console.error("[meetings/export] GET error:", error);
    return apiServerError("Failed to generate PPTX");
  }
}
