/**
 * Tests for Image, ImageGroup, and Caption element handling in extractHtmlContent.
 *
 * These elements appear in schedules and forms in legislation, particularly in
 * acts that define symbols, emblems, flags, and other visual elements.
 *
 * Note: ImageGroup elements must be within a Provision in DocumentInternal
 * to be parsed into sections. The parser creates sections for Provision elements.
 */

import { expect, test } from "@playwright/test";
import { parseActXml } from "@/lib/legislation/parser";

/**
 * Helper to create a minimal Act XML with a Schedule containing image elements
 * wrapped in DocumentInternal/Provision structure
 */
function createActXmlWithSchedule(scheduleContent: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<Statute xml:lang="en">
  <Identification>
    <Chapter>
      <ConsolidatedNumber>I-1</ConsolidatedNumber>
    </Chapter>
    <ShortTitle>Image Test Act</ShortTitle>
  </Identification>
  <Body>
    <Section>
      <Label>1</Label>
      <Text>Main section content</Text>
    </Section>
  </Body>
  <Schedule id="schedule-1">
    <ScheduleFormHeading>
      <Label>SCHEDULE</Label>
      <TitleText>Images</TitleText>
    </ScheduleFormHeading>
    <DocumentInternal>
      ${scheduleContent}
    </DocumentInternal>
  </Schedule>
</Statute>`;
}

test.describe("ImageGroup handling in extractHtmlContent", () => {
  test("wraps ImageGroup in figure with class", () => {
    const xml = createActXmlWithSchedule(`
      <Provision>
        <Text>Image content:</Text>
        <ImageGroup position="inline">
          <Image source="test-image.jpg" />
        </ImageGroup>
      </Provision>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    expect(scheduleSections.length).toBeGreaterThan(0);

    const contentHtml = scheduleSections[0].contentHtml;
    expect(contentHtml).toContain('<figure class="image-group"');
    expect(contentHtml).toContain("</figure>");
  });

  test("preserves position attribute as data attribute", () => {
    const xml = createActXmlWithSchedule(`
      <Provision>
        <ImageGroup position="inline">
          <Image source="test-image.jpg" />
        </ImageGroup>
      </Provision>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    const contentHtml = scheduleSections[0]?.contentHtml || "";

    expect(contentHtml).toContain('data-position="inline"');
  });

  test("handles ImageGroup without position attribute", () => {
    const xml = createActXmlWithSchedule(`
      <Provision>
        <ImageGroup>
          <Image source="test-image.jpg" />
        </ImageGroup>
      </Provision>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    const contentHtml = scheduleSections[0]?.contentHtml || "";

    expect(contentHtml).toContain('<figure class="image-group">');
    expect(contentHtml).not.toContain("data-position");
  });
});

test.describe("Image element handling in extractHtmlContent", () => {
  test("renders Image as img element with proper attributes", () => {
    const xml = createActXmlWithSchedule(`
      <Provision>
        <ImageGroup position="inline">
          <Image source="2007c-25_ef001.jpg" />
        </ImageGroup>
      </Provision>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    const contentHtml = scheduleSections[0]?.contentHtml || "";

    expect(contentHtml).toContain("<img");
    expect(contentHtml).toContain('class="legislation-image"');
    expect(contentHtml).toContain('loading="lazy"');
  });

  test("normalizes image source to absolute path", () => {
    const xml = createActXmlWithSchedule(`
      <Provision>
        <ImageGroup position="inline">
          <Image source="my-image.jpg" />
        </ImageGroup>
      </Provision>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    const contentHtml = scheduleSections[0]?.contentHtml || "";

    expect(contentHtml).toContain('src="/legislation/images/my-image.jpg"');
  });

  test("preserves full URLs as-is", () => {
    const xml = createActXmlWithSchedule(`
      <Provision>
        <ImageGroup position="inline">
          <Image source="https://example.com/image.jpg" />
        </ImageGroup>
      </Provision>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    const contentHtml = scheduleSections[0]?.contentHtml || "";

    expect(contentHtml).toContain('src="https://example.com/image.jpg"');
  });

  test("preserves absolute paths as-is", () => {
    const xml = createActXmlWithSchedule(`
      <Provision>
        <ImageGroup position="inline">
          <Image source="/images/absolute-path.jpg" />
        </ImageGroup>
      </Provision>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    const contentHtml = scheduleSections[0]?.contentHtml || "";

    expect(contentHtml).toContain('src="/images/absolute-path.jpg"');
  });

  test("handles multiple images in ImageGroup", () => {
    const xml = createActXmlWithSchedule(`
      <Provision>
        <ImageGroup position="inline">
          <Image source="image1.jpg" />
          <Image source="image2.jpg" />
          <Image source="image3.jpg" />
        </ImageGroup>
      </Provision>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    const contentHtml = scheduleSections[0]?.contentHtml || "";

    const imgMatches = contentHtml.match(/<img/g) || [];
    expect(imgMatches.length).toBe(3);
    expect(contentHtml).toContain("image1.jpg");
    expect(contentHtml).toContain("image2.jpg");
    expect(contentHtml).toContain("image3.jpg");
  });

  test("escapes special characters in image source", () => {
    const xml = createActXmlWithSchedule(`
      <Provision>
        <ImageGroup position="inline">
          <Image source="image&amp;special.jpg" />
        </ImageGroup>
      </Provision>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    const contentHtml = scheduleSections[0]?.contentHtml || "";

    expect(contentHtml).toContain("image&amp;special.jpg");
  });
});

test.describe("Caption element handling in extractHtmlContent", () => {
  test("renders Caption as figcaption with class", () => {
    const xml = createActXmlWithSchedule(`
      <Provision>
        <ImageGroup position="inline">
          <Image source="test-image.jpg" />
          <Caption>This is the image caption</Caption>
        </ImageGroup>
      </Provision>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    const contentHtml = scheduleSections[0]?.contentHtml || "";

    expect(contentHtml).toContain('<figcaption class="image-caption">');
    expect(contentHtml).toContain("This is the image caption");
    expect(contentHtml).toContain("</figcaption>");
  });

  test("preserves text formatting within Caption", () => {
    const xml = createActXmlWithSchedule(`
      <Provision>
        <ImageGroup position="inline">
          <Image source="test-image.jpg" />
          <Caption>Figure 1: <Emphasis style="italic">The National Flag</Emphasis></Caption>
        </ImageGroup>
      </Provision>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    const contentHtml = scheduleSections[0]?.contentHtml || "";

    expect(contentHtml).toContain('<figcaption class="image-caption">');
    expect(contentHtml).toContain("Figure 1:");
    expect(contentHtml).toContain("<em>");
    expect(contentHtml).toContain("The National Flag");
    expect(contentHtml).toContain("</em>");
  });

  test("handles Caption with bilingual content", () => {
    const xml = createActXmlWithSchedule(`
      <Provision>
        <ImageGroup position="inline">
          <Image source="test-image.jpg" />
          <Caption>
            <BilingualGroup>
              <BilingualItemEn>English Caption</BilingualItemEn>
              <BilingualItemFr>Légende française</BilingualItemFr>
            </BilingualGroup>
          </Caption>
        </ImageGroup>
      </Provision>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    const contentHtml = scheduleSections[0]?.contentHtml || "";

    expect(contentHtml).toContain('<figcaption class="image-caption">');
    expect(contentHtml).toContain('class="bilingual-en"');
    expect(contentHtml).toContain("English Caption");
    expect(contentHtml).toContain('class="bilingual-fr"');
    expect(contentHtml).toContain("Légende française");
  });
});

test.describe("Combined Image structure handling", () => {
  test("handles complete image structure with group, image, and caption", () => {
    const xml = createActXmlWithSchedule(`
      <Provision>
        <Text>The following is the official emblem:</Text>
        <ImageGroup position="inline">
          <Image source="2007c-25_ef001.jpg" />
          <Caption>Official Emblem of Canada</Caption>
        </ImageGroup>
      </Provision>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    const contentHtml = scheduleSections[0]?.contentHtml || "";

    // Verify overall structure
    expect(contentHtml).toContain('<figure class="image-group"');
    expect(contentHtml).toContain(
      'src="/legislation/images/2007c-25_ef001.jpg"'
    );
    expect(contentHtml).toContain('<figcaption class="image-caption">');
    expect(contentHtml).toContain("Official Emblem of Canada");
    expect(contentHtml).toContain("</figcaption>");
    expect(contentHtml).toContain("</figure>");
  });

  test("handles multiple Provisions with ImageGroups", () => {
    const xml = createActXmlWithSchedule(`
      <Provision>
        <ImageGroup position="inline">
          <Image source="image1.jpg" />
          <Caption>First image</Caption>
        </ImageGroup>
      </Provision>
      <Provision>
        <ImageGroup position="inline">
          <Image source="image2.jpg" />
          <Caption>Second image</Caption>
        </ImageGroup>
      </Provision>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );

    // Each provision is a separate section
    expect(scheduleSections.length).toBe(2);

    expect(scheduleSections[0].contentHtml).toContain("First image");
    expect(scheduleSections[1].contentHtml).toContain("Second image");
  });

  test("handles nested ImageGroup within DocumentInternal Group", () => {
    const xml = createActXmlWithSchedule(`
      <Group>
        <GroupHeading><Label>Article I</Label><TitleText>Symbols</TitleText></GroupHeading>
        <Provision>
          <Text>The official symbol is depicted below:</Text>
          <ImageGroup position="inline">
            <Image source="symbol.jpg" />
            <Caption>Official Symbol</Caption>
          </ImageGroup>
        </Provision>
      </Group>
    `);
    const result = parseActXml(xml, "en");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    const contentHtml = scheduleSections[0]?.contentHtml || "";

    expect(contentHtml).toContain('<figure class="image-group"');
    expect(contentHtml).toContain("symbol.jpg");
    expect(contentHtml).toContain("Official Symbol");
  });
});

test.describe("French image content handling", () => {
  test("handles French ImageGroup structure", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<Statute xml:lang="fr">
  <Identification>
    <Chapter>
      <ConsolidatedNumber>I-1</ConsolidatedNumber>
    </Chapter>
    <ShortTitle>Loi sur les images</ShortTitle>
  </Identification>
  <Body>
    <Section>
      <Label>1</Label>
      <Text>Contenu principal</Text>
    </Section>
  </Body>
  <Schedule id="annexe-1">
    <ScheduleFormHeading>
      <Label>ANNEXE</Label>
      <TitleText>Images</TitleText>
    </ScheduleFormHeading>
    <DocumentInternal>
      <Provision>
        <ImageGroup position="inline">
          <Image source="drapeau.jpg" />
          <Caption>Le drapeau national du Canada</Caption>
        </ImageGroup>
      </Provision>
    </DocumentInternal>
  </Schedule>
</Statute>`;
    const result = parseActXml(xml, "fr");

    const scheduleSections = result.sections.filter(
      (s) => s.sectionType === "schedule"
    );
    expect(scheduleSections.length).toBeGreaterThan(0);

    const contentHtml = scheduleSections[0]?.contentHtml || "";
    expect(contentHtml).toContain('<figure class="image-group"');
    expect(contentHtml).toContain("drapeau.jpg");
    expect(contentHtml).toContain("Le drapeau national du Canada");
  });
});
