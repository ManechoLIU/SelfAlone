import PptxGenJS from "pptxgenjs";

export type DevelopmentPage = {
  title: string;
  body: string;
};

export type DevelopmentPresentation = {
  title: string;
  pages: DevelopmentPage[];
};

export async function generateDevelopmentPptx(
  presentation: DevelopmentPresentation,
  outputPath: string,
) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "老己 SelfAlone";
  pptx.subject = "开发闭环生成的可编辑演示文稿";
  pptx.title = presentation.title;
  pptx.company = "SelfAlone";
  pptx.theme = {
    headFontFace: "PingFang SC",
    bodyFontFace: "PingFang SC",
  };

  for (const [index, page] of presentation.pages.entries()) {
    const slide = pptx.addSlide();
    slide.background = { color: index % 2 === 0 ? "F6FAF8" : "EEF5F1" };
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 0.16,
      h: 7.5,
      line: { color: "4D7D6B", transparency: 100 },
      fill: { color: "4D7D6B" },
    });
    slide.addText(presentation.title, {
      x: 0.7,
      y: 0.55,
      w: 11.9,
      h: 0.45,
      fontFace: "PingFang SC",
      fontSize: 14,
      color: "668177",
      margin: 0,
      breakLine: false,
    });
    slide.addText(page.title, {
      x: 0.7,
      y: 1.45,
      w: 11.4,
      h: 0.8,
      fontFace: "PingFang SC",
      fontSize: 35,
      bold: true,
      color: "183C31",
      margin: 0,
      breakLine: false,
    });
    slide.addText(page.body, {
      x: 0.7,
      y: 2.65,
      w: 8.8,
      h: 2.2,
      fontFace: "PingFang SC",
      fontSize: 20,
      color: "3E554D",
      breakLine: false,
      valign: "middle",
      margin: 0,
    });
    slide.addText(`${index + 1} / ${presentation.pages.length}`, {
      x: 10.9,
      y: 6.72,
      w: 1.45,
      h: 0.3,
      fontFace: "PingFang SC",
      fontSize: 10,
      color: "7C8F88",
      align: "right",
      margin: 0,
    });
  }

  await pptx.writeFile({ fileName: outputPath });

  return {
    outputPath,
    pageCount: presentation.pages.length,
    aspectRatio: "16:9" as const,
  };
}
